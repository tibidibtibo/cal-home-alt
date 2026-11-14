import asyncio
import json
import logging
import os
import re
import threading
import time
import requests as _requests
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import date as date_type, datetime
import pytz
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from pydantic import BaseModel

from .state import state_manager
from .api import box_tracker
from .config import settings
from . import schedules_db
from . import scheduler as app_scheduler
from . import logs
from . import notifications
from . import database
from . import auth
from .paths import ROOT

logs.setup_logging()
_LOGGER = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()

    state_manager.loop = asyncio.get_running_loop()
    thread = threading.Thread(target=state_manager.polling_thread, daemon=True)
    thread.start()
    _LOGGER.info("Started polling thread")

    app_scheduler.scheduler.start()
    app_scheduler.load_all_schedules()
    _LOGGER.info("Started scheduler")

    yield
    app_scheduler.scheduler.shutdown()


app = FastAPI(title="Calyps'HOME API", lifespan=lifespan)


# --- Models ---

class LevelRequest(BaseModel):
    level: int

class TiltRequest(BaseModel):
    angle: int


class LoginRequest(BaseModel):
    username: str
    password: str


class SetupAccountRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UserCreateRequest(BaseModel):
    username: str
    password: str


class HouseRequest(BaseModel):
    name: str


class SetupRoomRequest(BaseModel):
    name: str
    card_id: Optional[int] = None


class ChannelRequest(BaseModel):
    channel: str

class BoxConfigRequest(BaseModel):
    host: str
    mac: str = ""

class CalypsCredsRequest(BaseModel):
    login: str
    password: str = ""

class LocationRequest(BaseModel):
    latitude: float
    longitude: float
    timezone: str

class CardRequest(BaseModel):
    name: str
    view_box: str = "0 0 900 600"
    north_angle: float = 0

class RoomRequest(BaseModel):
    card_id: int
    name: str
    x: float
    y: float
    width: float
    height: float

class PlacementRequest(BaseModel):
    card_id: Optional[int]
    x: Optional[float]
    y: Optional[float]


class CustomDeviceRequest(BaseModel):
    name: str
    url: str
    type: str = "shutter"

class SmtpConfigRequest(BaseModel):
    host: str
    port: int = 587
    user: str = ""
    password: str = ""
    from_addr: str = ""
    email_to: str = ""

class PollIntervalRequest(BaseModel):
    interval: int


class ShutterConfigUpdateRequest(BaseModel):
    custom_name: Optional[str] = None
    orientation: int
    color: Optional[str] = None
    room_id: Optional[int] = None   # absent = inchangé ; null = retirer la pièce
    sun_level: Optional[int] = None # absent = inchangé
    p1_level: Optional[int] = None  # absent = inchangé ; null = effacer
    p2_level: Optional[int] = None  # absent = inchangé ; null = effacer


class ReassociateRequest(BaseModel):
    api_id: str


# --- Auth middleware ---

# Routes de connexion, seules publiques (refresh contrôle lui-même son jeton). Tout le reste de /api exige un jeton.
_PUBLIC_AUTH_PATHS = {
    "/api/auth/status",
    "/api/auth/setup",
    "/api/auth/login",
    "/api/auth/refresh",
}

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path

    if not path.startswith("/api/") or path in _PUBLIC_AUTH_PATHS:
        return await call_next(request)

    # Jeton dans l'en-tête Bearer ; seul le flux SSE (EventSource, sans en-têtes) accepte un ticket à usage unique en paramètre.
    token: Optional[str] = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1]
    elif path == "/api/events" and "ticket" in request.query_params:
        if auth.consume_sse_ticket(request.query_params["ticket"]):
            return await call_next(request)
        return JSONResponse(status_code=401, content={"detail": "Invalid or expired ticket"})

    username = await run_in_threadpool(auth.user_from_token, token) if token else None
    if not username:
        return JSONResponse(
            status_code=401,
            content={"detail": "Not authenticated"},
        )
    request.state.user = username

    return await call_next(request)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time

    logs.access_logger.info(
        f"{request.method} {request.url.path} - {response.status_code}",
        extra={"extra_data": {
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration": duration,
            "ip": request.client.host if request.client else None,
            "source": getattr(request.state, "source", "user"),
        }},
    )
    return response


# --- Auth endpoints ---

def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


@app.get("/api/auth/status")
def auth_status():
    """Public : dit à l'interface s'il faut créer le premier compte."""
    return {"setup_required": database.count_users() == 0}


@app.post("/api/auth/setup")
def create_first_account(req: SetupAccountRequest, request: Request):
    """Premier lancement : crée le compte administrateur. Refusé dès qu'un compte existe."""
    ip = _client_ip(request)
    if auth.login_blocked(ip):
        raise HTTPException(status_code=429, detail="Trop de tentatives, réessayez dans quelques minutes")
    username = auth.check_username(req.username)
    auth.check_password_strength(req.password)
    if not database.create_first_user(username, auth.hash_password(req.password)):
        auth.login_failed(ip)
        raise HTTPException(status_code=409, detail="La configuration initiale est déjà faite : connectez-vous")
    _LOGGER.info(f"First account created: {username}")
    return {"token": auth.create_token(username)}


@app.post("/api/auth/refresh")
def refresh_token(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    # Seul un jeton encore valide est prolongé, et jamais au-delà de SESSION_MAX_HOURS depuis la connexion initiale.
    payload = auth.decode_token(auth_header.split(" ", 1)[1])
    username = payload.get("sub") if payload else None
    if not username or database.get_user_hash(username) is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    auth_time = int(payload.get("auth_time") or payload.get("exp", 0) - auth.TOKEN_EXPIRE_HOURS * 3600)
    if time.time() - auth_time > auth.SESSION_MAX_HOURS * 3600:
        raise HTTPException(status_code=401, detail="Session expired")

    return {"token": auth.create_token(username, auth_time)}


@app.post("/api/auth/login")
def login(req: LoginRequest, request: Request):
    ip = _client_ip(request)
    if auth.login_blocked(ip):
        raise HTTPException(status_code=429, detail="Trop de tentatives, réessayez dans quelques minutes")
    username = auth.authenticate(req.username, req.password)
    if not username:
        auth.login_failed(ip)
        raise HTTPException(status_code=401, detail="Nom d'utilisateur ou mot de passe incorrect")
    auth.login_succeeded(ip)
    return {"token": auth.create_token(username)}


@app.post("/api/auth/sse-ticket")
def sse_ticket(_=Depends(auth.require_auth)):
    """Ticket à usage unique (60 s) à passer à /api/events?ticket=… : le JWT ne figure jamais dans une URL."""
    return {"ticket": auth.issue_sse_ticket()}


@app.get("/api/auth/me")
def me(request: Request):
    return {"username": request.state.user}


@app.post("/api/auth/change-password")
def change_password(req: ChangePasswordRequest, request: Request):
    username = request.state.user
    hashed = database.get_user_hash(username)
    if not hashed or not auth.verify_password(req.current_password, hashed):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect")
    auth.check_password_strength(req.new_password)
    database.set_user_password(username, auth.hash_password(req.new_password))
    return {"ok": True}


@app.get("/api/auth/users")
def get_users():
    return database.list_users()


@app.post("/api/auth/users")
def add_user(req: UserCreateRequest):
    username = auth.check_username(req.username)
    auth.check_password_strength(req.password)
    if not database.add_user(username, auth.hash_password(req.password)):
        raise HTTPException(status_code=409, detail="Ce nom d'utilisateur existe déjà")
    return {"ok": True}


@app.delete("/api/auth/users/{username}")
def delete_user(username: str, request: Request):
    username = database.normalize_username(username)
    if username == request.state.user:
        raise HTTPException(status_code=409, detail="Vous ne pouvez pas supprimer votre propre compte")
    if not database.delete_user(username):
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return {"ok": True}


# --- Device endpoints ---

@app.get("/api/devices")
def get_devices():
    return state_manager.get_devices_dict()


@app.get("/api/shutters")
def get_shutters_legacy():
    # Legacy support
    return state_manager.get_devices_dict()


@app.post("/api/devices/{index}/open")
async def open_device(index: str):
    real_id = state_manager.get_real_id(index)
    if not real_id:
        raise HTTPException(status_code=404, detail="Device not found")
    ok = await asyncio.to_thread(state_manager.api.open_shutter, real_id)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to send command to box")
    state_manager.request_refresh(burst=True)
    return {"ok": True}


@app.post("/api/shutters/{index}/open")
async def open_shutter_legacy(index: str):
    return await open_device(index)


@app.post("/api/devices/{index}/close")
async def close_device(index: str):
    real_id = state_manager.get_real_id(index)
    if not real_id:
        raise HTTPException(status_code=404, detail="Device not found")
    ok = await asyncio.to_thread(state_manager.api.close_shutter, real_id)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to send command to box")
    state_manager.request_refresh(burst=True)
    return {"ok": True}


@app.post("/api/shutters/{index}/close")
async def close_shutter_legacy(index: str):
    return await close_device(index)


@app.post("/api/devices/{index}/stop")
async def stop_device(index: str):
    real_id = state_manager.get_real_id(index)
    if not real_id:
        raise HTTPException(status_code=404, detail="Device not found")
    ok = await asyncio.to_thread(state_manager.api.stop_shutter, real_id)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to send command to box")
    state_manager.request_refresh(burst=True)
    return {"ok": True}


@app.post("/api/shutters/{index}/stop")
async def stop_shutter_legacy(index: str):
    return await stop_device(index)


@app.post("/api/devices/{index}/level")
async def set_device_level(index: str, req: LevelRequest):
    real_id = state_manager.get_real_id(index)
    if not real_id:
        raise HTTPException(status_code=404, detail="Device not found")
    ok = await asyncio.to_thread(state_manager.api.set_level, real_id, req.level)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to send command to box")
    state_manager.request_refresh(burst=True)
    return {"ok": True}


@app.post("/api/shutters/{index}/level")
async def set_level_legacy(index: str, req: LevelRequest):
    return await set_device_level(index, req)


@app.post("/api/devices/{index}/tilt")
async def set_device_tilt(index: str, req: TiltRequest):
    real_id = state_manager.get_real_id(index)
    if not real_id:
        raise HTTPException(status_code=404, detail="Device not found")

    with state_manager._lock:
        try:
            device = state_manager.devices[int(index)]
            if not device.has_tilt:
                raise HTTPException(status_code=400, detail="Device does not support tilt")
        except (ValueError, IndexError):
            raise HTTPException(status_code=404, detail="Device not found")

    ok = await asyncio.to_thread(state_manager.api.set_tilt, real_id, req.angle)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to send command to box")
    state_manager.request_refresh(burst=True)
    return {"ok": True}


@app.post("/api/shutters/{index}/tilt")
async def set_tilt_legacy(index: str, req: TiltRequest):
    return await set_device_tilt(index, req)


class DeviceRoomRequest(BaseModel):
    room_id: Optional[int] = None


@app.put("/api/devices/{db_id}/room")
async def update_device_room(db_id: int, req: DeviceRoomRequest):
    """Classer un appareil dans une pièce (null = non classé)."""
    if req.room_id is not None and not await asyncio.to_thread(database.room_exists, req.room_id):
        raise HTTPException(status_code=400, detail="Pièce inconnue")
    ok = await asyncio.to_thread(database.set_device_room, db_id, req.room_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Device not found")
    await state_manager.refresh_config()
    return {"ok": True}


@app.put("/api/devices/{db_id}/placement")
async def update_device_placement(db_id: int, req: PlacementRequest):
    result = await asyncio.to_thread(database.update_device_placement, db_id, req.card_id, req.x, req.y)
    if not result:
        raise HTTPException(status_code=404, detail="Device not found")
    await state_manager.refresh_config()
    return result


_SSE_HEARTBEAT = 15.0


@app.get("/api/events")
async def events(request: Request):
    q = state_manager.subscribe()

    async def event_generator():
        try:
            while True:
                try:
                    item = await asyncio.wait_for(q.get(), timeout=_SSE_HEARTBEAT)
                    event, data = item if isinstance(item, tuple) else ("devices", item)
                    # « devices » = message par défaut (onmessage) ; « status » = événement nommé (état de la box)
                    prefix = "" if event == "devices" else f"event: {event}\n"
                    yield f"{prefix}data: {json.dumps(data)}\n\n"
                except asyncio.TimeoutError:
                    # Commentaire SSE : garde la connexion ouverte à travers Caddy / nginx et détecte les clients partis
                    if await request.is_disconnected():
                        break
                    yield ": keepalive\n\n"
        finally:
            state_manager.unsubscribe(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- Box config endpoints ---

@app.get("/api/box/config")
def get_box_config():
    return {"host": settings.calyps_host, "mac": settings.calyps_mac}


@app.put("/api/box/config")
def update_box_config(req: BoxConfigRequest):
    host = req.host.strip()
    mac = req.mac.strip()
    if not host:
        raise HTTPException(status_code=400, detail="host is required")
    database.set_setting("CALYPS_HOST", host)
    database.set_setting("CALYPS_MAC", mac)
    state_manager.update_api_config(host)
    return {"ok": True}


@app.get("/api/box/credentials")
def get_box_credentials():
    return {"login": settings.calyps_login, "password_set": bool(settings.calyps_password)}


@app.put("/api/box/credentials")
def update_box_credentials(req: CalypsCredsRequest):
    login = req.login.strip()
    password = req.password.strip()
    if not login:
        raise HTTPException(status_code=400, detail="login is required")
    database.set_setting("CALYPS_LOGIN", login)
    if password:
        database.set_setting("CALYPS_PASSWORD", password)
    state_manager.update_api_creds(login, settings.calyps_password)
    return {"ok": True}


def _walk_exceptions(exc: BaseException):
    seen: set[int] = set()
    stack: list[BaseException] = [exc]
    while stack:
        cur = stack.pop()
        if id(cur) in seen:
            continue
        seen.add(id(cur))
        yield cur
        if cur.__cause__ is not None:
            stack.append(cur.__cause__)
        if cur.__context__ is not None:
            stack.append(cur.__context__)
        for arg in getattr(cur, "args", ()):
            if isinstance(arg, BaseException):
                stack.append(arg)


def _is_connection_reset(exc: BaseException) -> bool:
    """Détecte un RST TCP en cours d'échange (port ouvert mais serveur HTTP qui coupe la connexion)."""
    return any(
        isinstance(cur, ConnectionResetError) or "connection reset" in str(cur).lower()
        for cur in _walk_exceptions(exc)
    )


def _is_connection_refused(exc: BaseException) -> bool:
    """Détecte un refus TCP immédiat (ECONNREFUSED : la box répond à l'IP mais son démon HTTP sur le port 80 est arrêté)."""
    return any(
        isinstance(cur, ConnectionRefusedError) or "connection refused" in str(cur).lower()
        for cur in _walk_exceptions(exc)
    )


def _box_http_error(exc: Exception) -> HTTPException:
    """Traduit une erreur réseau/HTTP vers la box en HTTPException explicite."""
    if isinstance(exc, _requests.exceptions.Timeout):
        return HTTPException(status_code=504, detail="Timeout — la box ne répond pas")
    if isinstance(exc, _requests.exceptions.InvalidURL):
        return HTTPException(status_code=400, detail="Adresse IP non configurée")
    if isinstance(exc, _requests.exceptions.ConnectionError):
        if _is_connection_reset(exc):
            return HTTPException(
                status_code=502,
                detail="La box répond sur le réseau mais son serveur HTTP a coupé la connexion (redémarrage de la box conseillé)",
            )
        if _is_connection_refused(exc):
            return HTTPException(
                status_code=502,
                detail="La box répond sur le réseau mais son port HTTP (80) est fermé — son serveur web interne est arrêté (redémarrage de la box conseillé)",
            )
        return HTTPException(status_code=502, detail="Impossible de joindre la box à cette adresse IP")
    if isinstance(exc, _requests.exceptions.HTTPError):
        return HTTPException(status_code=502, detail=f"Réponse HTTP invalide de la box : {exc}")
    return HTTPException(status_code=502, detail=f"Erreur : {exc}")


@app.post("/api/box/ping")
def ping_box():
    host = settings.calyps_host
    if not host:
        raise HTTPException(status_code=400, detail="Adresse IP non configurée")
    try:
        # Un simple handshake TCP ne suffit pas : on vérifie que le serveur HTTP répond (même 401/403/404).
        with box_tracker.track("ping", target=host):
            _requests.get(f"http://{host}/", timeout=5)
        return {"ok": True}
    except Exception as e:
        raise _box_http_error(e)


@app.get("/api/box/queue")
def get_box_queue():
    """État en temps réel de la file d'attente HTTP vers la box, requête en cours et statistiques de temps de réponse."""
    return state_manager.get_box_queue_snapshot()


@app.delete("/api/box/queue/history")
def clear_box_queue_history():
    """Réinitialise l'historique et les compteurs de requêtes vers la box."""
    box_tracker.clear_history()
    return {"ok": True}


@app.post("/api/box/test")
def test_box_connection():
    try:
        data = state_manager.api.test_connection()
        if not data:
            raise HTTPException(status_code=502, detail="La box ne retourne pas de données — identifiants incorrects ?")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise _box_http_error(e)


# --- Location / solar ---

@app.get("/api/settings/location")
def get_location():
    return {
        "latitude": settings.latitude,
        "longitude": settings.longitude,
        "timezone": settings.timezone,
    }


@app.put("/api/settings/location")
def update_location(req: LocationRequest):
    if not (-90 <= req.latitude <= 90):
        raise HTTPException(status_code=400, detail="latitude must be between -90 and 90")
    if not (-180 <= req.longitude <= 180):
        raise HTTPException(status_code=400, detail="longitude must be between -180 and 180")
    try:
        pytz.timezone(req.timezone.strip())
    except pytz.UnknownTimeZoneError:
        raise HTTPException(status_code=400, detail="Fuseau horaire inconnu (exemple : Europe/Paris)")
    database.set_setting("LATITUDE", str(req.latitude))
    database.set_setting("LONGITUDE", str(req.longitude))
    database.set_setting("TIMEZONE", req.timezone.strip())
    # Les horaires lever/coucher déjà planifiés pour aujourd'hui dépendent des coordonnées.
    app_scheduler.load_all_schedules()
    return {"ok": True}


@app.get("/api/sun/times")
def get_sun_times(date: Optional[str] = None):
    """Lever/coucher du soleil (HH:MM, fuseau configuré) pour `date` (YYYY-MM-DD, défaut : aujourd'hui)."""
    from . import sun as _sun
    for_date = None
    if date:
        try:
            for_date = date_type.fromisoformat(date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")
    return {**_sun.get_sun_times(for_date), **_sun.get_day_type(for_date), "timezone": settings.timezone}


@app.get("/api/settings/poll-interval")
def get_poll_interval():
    return {"interval": settings.poll_interval}


@app.put("/api/settings/poll-interval")
def update_poll_interval(req: PollIntervalRequest):
    if req.interval < 10:
        raise HTTPException(status_code=400, detail="interval must be at least 10 seconds")
    database.set_setting("POLL_INTERVAL", str(req.interval))
    return {"ok": True}


# --- Floorplan (Cards & Rooms) ---

@app.get("/api/cards")
def get_cards():
    return database.get_all_cards()


@app.post("/api/cards")
def create_card(req: CardRequest):
    return database.create_card(req.name, req.view_box, req.north_angle)


@app.put("/api/cards/{id}")
def update_card(id: int, req: CardRequest):
    return database.update_card(id, req.name, req.view_box, req.north_angle)


@app.delete("/api/cards/{id}")
def delete_card(id: int):
    database.delete_card(id)
    state_manager.request_refresh_threadsafe()
    return {"ok": True}


@app.get("/api/rooms")
def get_all_rooms():
    return database.get_all_rooms()


@app.get("/api/cards/{id}/rooms")
def get_rooms(id: int):
    return database.get_rooms_by_card(id)


@app.post("/api/rooms")
def create_room(req: RoomRequest):
    result = database.create_room(req.card_id, req.name, req.x, req.y, req.width, req.height)
    state_manager.request_refresh_threadsafe()
    return result


@app.put("/api/rooms/{id}")
def update_room(id: int, req: RoomRequest):
    result = database.update_room(id, req.card_id, req.name, req.x, req.y, req.width, req.height)
    state_manager.request_refresh_threadsafe()
    return result


@app.delete("/api/rooms/{id}")
def delete_room(id: int):
    database.delete_room(id)
    state_manager.request_refresh_threadsafe()
    return {"ok": True}


@app.post("/api/devices/custom")
async def create_custom_device(req: CustomDeviceRequest):
    extra = json.dumps({"url": req.url, "custom_type": req.type})
    api_id = f"custom-{int(time.time())}"
    result = database.upsert_device(api_id, req.name, "custom_api")
    database.update_device(result["id"], req.name, 180, None, None, None, extra)
    await state_manager.update_state()
    return {"ok": True}


@app.put("/api/devices/custom/{db_id}")
async def update_custom_device(db_id: int, req: CustomDeviceRequest):
    extra = json.dumps({"url": req.url, "custom_type": req.type})
    database.update_device(db_id, req.name, 180, None, None, None, extra)
    await state_manager.update_state()
    return {"ok": True}


@app.delete("/api/devices/custom/{db_id}")
async def delete_custom_device(db_id: int):
    conn = database.get_db()
    try:
        conn.execute("DELETE FROM devices WHERE id = ?", (db_id,))
        conn.commit()
    finally:
        conn.close()
    await state_manager.update_state()
    return {"ok": True}


@app.get("/api/floorplan")
def get_floorplan(card_id: Optional[int] = None):
    # Backward compatibility and single endpoint for filtered data
    cards = database.get_all_cards() or [_ensure_card()]

    selected_card = cards[0]
    if card_id:
        for c in cards:
            if c["id"] == card_id:
                selected_card = c
                break

    rooms = database.get_rooms_by_card(selected_card["id"])
    devices = [d for d in state_manager.get_devices_dict() if d["card_id"] == selected_card["id"]]

    return {
        "card": selected_card,
        "rooms": rooms,
        "devices": devices,
        "all_cards": cards
    }




# --- Assistant de première configuration ---

_PLAN_WIDTH = 900
_PLAN_MIN_HEIGHT = 600
_SLOT_W, _SLOT_H, _SLOT_PAD, _SLOT_COLS = 270, 190, 30, 3


def _slot_rect(index: int) -> tuple[float, float, float, float]:
    """Emplacement n°`index` d'une grille de pièces (3 colonnes) dans le plan : x, y, largeur, hauteur."""
    col, row = index % _SLOT_COLS, index // _SLOT_COLS
    return (_SLOT_PAD + col * _SLOT_W, _SLOT_PAD + row * _SLOT_H, _SLOT_W - 10, _SLOT_H - 10)


def _overlaps(a: tuple, b: tuple) -> bool:
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def _ensure_card() -> dict:
    """Première carte (« étage ») : créée vide au besoin, nommée d'après la maison."""
    cards = database.get_all_cards()
    if cards:
        return cards[0]
    name = database.get_setting("HOUSE_NAME").strip() or "Maison"
    return database.create_card(name, f"0 0 {_PLAN_WIDTH} {_PLAN_MIN_HEIGHT}", 0)


@app.get("/api/settings/house")
def get_house():
    return {"name": database.get_setting("HOUSE_NAME"), "setup_completed": database.get_setting("SETUP_COMPLETED") == "1"}


@app.put("/api/settings/house")
def update_house(req: HouseRequest):
    name = req.name.strip()
    if not name or len(name) > 60:
        raise HTTPException(status_code=400, detail="Le nom de la maison doit faire entre 1 et 60 caractères")
    database.set_setting("HOUSE_NAME", name)
    return {"ok": True}


@app.post("/api/setup/complete")
def complete_setup():
    database.set_setting("SETUP_COMPLETED", "1")
    return {"ok": True}


@app.post("/api/setup/rooms")
def add_room_auto(req: SetupRoomRequest):
    """Ajoute une pièce au premier emplacement libre du plan (l'utilisateur la déplace ensuite sur la page Plan)."""
    name = req.name.strip()
    if not name or len(name) > 60:
        raise HTTPException(status_code=400, detail="Le nom de la pièce doit faire entre 1 et 60 caractères")
    card = next((c for c in database.get_all_cards() if c["id"] == req.card_id), None) if req.card_id else _ensure_card()
    if card is None:
        raise HTTPException(status_code=404, detail="Plan introuvable")
    taken = [(r["x"], r["y"], r["width"], r["height"]) for r in database.get_rooms_by_card(card["id"])]
    index = 0
    while any(_overlaps(_slot_rect(index), t) for t in taken):
        index += 1
    x, y, w, h = _slot_rect(index)
    room = database.create_room(card["id"], name, x, y, w, h)
    # Le plan s'agrandit vers le bas quand les pièces ne tiennent plus.
    needed = int(y + h + _SLOT_PAD)
    parts = card["view_box"].split()
    if len(parts) == 4 and needed > float(parts[3]):
        database.update_card(card["id"], card["name"], f"{parts[0]} {parts[1]} {parts[2]} {needed}", card["north_angle"])
    state_manager.request_refresh_threadsafe()
    return room


@app.post("/api/setup/autoplace")
async def autoplace_devices():
    """Pose sur le plan les appareils classés dans une pièce mais pas encore placés (répartis dans la pièce)."""
    devices = await asyncio.to_thread(database.get_all_devices)
    rooms = {}
    for card in await asyncio.to_thread(database.get_all_cards):
        for r in await asyncio.to_thread(database.get_rooms_by_card, card["id"]):
            rooms[r["id"]] = r
    pending: dict[int, list[dict]] = {}
    for d in devices:
        if d["room_id"] in rooms and d["card_id"] is None:
            pending.setdefault(d["room_id"], []).append(d)
    placed = 0
    for room_id, group in pending.items():
        r = rooms[room_id]
        for k, d in enumerate(group, start=1):
            x = r["x"] + r["width"] * k / (len(group) + 1)
            y = r["y"] + r["height"] * 0.78   # sous le nom de la pièce, qui est centré
            await asyncio.to_thread(database.update_device_placement, d["id"], r["card_id"], x, y)
            placed += 1
    if placed:
        await state_manager.refresh_config()
    return {"placed": placed}


# --- Health / refresh ---

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "box_reachable": state_manager.box_reachable,
        "shutters_count": len(state_manager.devices),
        "last_poll": state_manager.last_poll.isoformat() if state_manager.last_poll else None,
    }


@app.post("/api/refresh")
async def refresh():
    await state_manager.update_state()
    return {
        "ok": True,
        "box_reachable": state_manager.box_reachable,
        "last_poll": state_manager.last_poll.isoformat() if state_manager.last_poll else None,
    }


# --- Schedule endpoints ---

_SCHEDULE_MODES = {"fixed", "presence", "solar", "absence"}
_SCHEDULE_ACTIONS = {"open", "close", "level"}


def _validate_schedule(data: dict, partial: bool) -> None:
    """Contrôle minimal d'une programmation (le corps est libre : l'ancien code acceptait n'importe quoi)."""
    def bad(msg: str):
        raise HTTPException(status_code=422, detail=msg)

    if not partial:
        for field in ("name", "mode", "action"):
            if not data.get(field):
                bad(f"Champ requis : {field}")
    if "name" in data and not (isinstance(data["name"], str) and data["name"].strip()):
        bad("Nom invalide")
    if "mode" in data and data["mode"] not in _SCHEDULE_MODES:
        bad(f"mode doit être l'un de {sorted(_SCHEDULE_MODES)}")
    if "action" in data and data["action"] not in _SCHEDULE_ACTIONS:
        bad(f"action doit être l'une de {sorted(_SCHEDULE_ACTIONS)}")
    level = data.get("level")
    if level is not None and not (isinstance(level, int) and not isinstance(level, bool) and 0 <= level <= 100):
        bad("level doit être un entier entre 0 et 100")
    for key in ("device_ids", "shutter_ids"):
        if key in data and not (isinstance(data[key], list) and all(isinstance(i, (int, str)) for i in data[key])):
            bad(f"{key} doit être une liste")
    if "params" in data and not isinstance(data["params"], dict):
        bad("params doit être un objet")
    if data.get("mode") == "presence" and isinstance(data.get("params"), dict) and data["params"]:
        params = data["params"]
        if params.get("sun_event") not in ("sunrise", "sunset"):
            bad("sun_event doit être 'sunrise' ou 'sunset'")
        offset = params.get("offset_min", 0)
        if not (isinstance(offset, int) and not isinstance(offset, bool) and -720 <= offset <= 720):
            bad("offset_min doit être un entier entre -720 et 720")
    if data.get("mode") == "absence" and isinstance(data.get("params"), dict) and data["params"]:
        params = data["params"]
        for key in ("open_weekday", "open_weekend"):
            value = params.get(key)
            if not (isinstance(value, str) and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value)):
                bad(f"{key} doit être une heure HH:MM")
        offset = params.get("close_offset_min", 10)
        if not (isinstance(offset, int) and not isinstance(offset, bool) and -720 <= offset <= 720):
            bad("close_offset_min doit être un entier entre -720 et 720")


@app.get("/api/schedules")
def get_schedules():
    return schedules_db.get_all_schedules()


@app.post("/api/schedules")
def create_schedule(data: dict):
    _validate_schedule(data, partial=False)
    if data.get("mode") == "solar":
        existing = [s for s in schedules_db.get_all_schedules() if s["mode"] == "solar"]
        if existing:
            raise HTTPException(
                status_code=409,
                detail="Une programmation BSO existe déjà. Modifiez-la plutôt que d'en créer une nouvelle.",
            )
    s = schedules_db.create_schedule(data)
    app_scheduler.load_all_schedules()
    return s


@app.put("/api/schedules/{id}")
def update_schedule(id: int, data: dict):
    _validate_schedule(data, partial=True)
    s = schedules_db.update_schedule(id, data)
    app_scheduler.load_all_schedules()
    return s


@app.delete("/api/schedules/{id}")
def delete_schedule(id: int):
    schedules_db.delete_schedule(id)
    app_scheduler.load_all_schedules()
    return {"ok": True}


@app.patch("/api/schedules/{id}/toggle")
def toggle_schedule(id: int, req: dict):
    enabled = req.get("enabled", True)
    schedules_db.toggle_schedule(id, enabled)
    app_scheduler.load_all_schedules()
    return {"enabled": enabled}


@app.get("/api/schedules/conflicts")
def get_conflicts():
    return schedules_db.detect_conflicts()


@app.get("/api/plan")
def get_day_plan(date: Optional[str] = None):
    """Planning d'un jour (défaut : aujourd'hui) : événements des règles actives + lever/coucher."""
    from . import sun as _sun
    for_date = None
    if date:
        try:
            for_date = date_type.fromisoformat(date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")
    for_date = for_date or datetime.now(pytz.timezone(settings.timezone)).date()
    return {
        "date": for_date.isoformat(),
        **_sun.get_sun_times(for_date),
        **_sun.get_day_type(for_date),
        "events": app_scheduler.get_day_plan(for_date),
    }


@app.get("/api/schedules/{id}/executions")
def get_executions(id: int):
    return schedules_db.get_executions(id)


@app.get("/api/schedules/{id}/bso-preview")
def get_bso_preview(id: int, date: str = ""):
    import pytz as _pytz
    schedules = [s for s in schedules_db.get_all_schedules() if s["id"] == id]
    if not schedules:
        raise HTTPException(status_code=404, detail="Schedule not found")
    s = schedules[0]
    if s["mode"] != "solar":
        raise HTTPException(status_code=400, detail="Not a solar schedule")

    params = s["params"]
    half_angle = params.get("half_angle", 60)
    alt_min = params.get("altitude_min", 20)
    az_offset = params.get("azimuth_offset", 0)
    alt_offset = params.get("altitude_offset", 0)
    effective_alt_min = alt_min + alt_offset

    for_date = None
    if date:
        try:
            for_date = date_type.fromisoformat(date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    from . import sun as _sun
    sun_times = _sun.get_sun_times(for_date)

    shutter_previews = []
    for shutter_idx in s["shutter_ids"]:
        orientation = state_manager.get_shutter_orientation(str(shutter_idx))
        if orientation is None:
            orientation = params.get("orientation", 180)

        transitions = _sun.compute_daily_transitions(
            orientation, half_angle, effective_alt_min, az_offset, for_date
        )

        name = f"Volet {shutter_idx}"
        with state_manager._lock:
            try:
                sh = state_manager.devices[int(shutter_idx)]
                name = sh.custom_name or sh.name
            except (IndexError, ValueError):
                pass

        shutter_previews.append({
            "index": shutter_idx,
            "name": name,
            "orientation": orientation,
            "transitions": transitions,
        })

    tz = _pytz.timezone(settings.timezone)
    preview_date = str(for_date) if for_date else str(__import__("datetime").datetime.now(tz).date())
    return {
        "date": preview_date,
        "sunrise": sun_times["sunrise"],
        "sunset": sun_times["sunset"],
        "shutters": shutter_previews,
    }


# --- Shutter config endpoints ---

@app.get("/api/shutter-config")
def get_shutter_configs():
    return database.get_all_devices()


@app.put("/api/shutter-config/{id}")
async def update_shutter_config(id: int, req: ShutterConfigUpdateRequest):
    if not (0 <= req.orientation <= 359):
        raise HTTPException(status_code=400, detail="orientation must be 0-359")
    for field_name in ("sun_level", "p1_level", "p2_level"):
        val = getattr(req, field_name)
        if val is not None and not (0 <= val <= 100):
            raise HTTPException(status_code=400, detail=f"{field_name} must be 0-100")
    set_room = "room_id" in req.model_fields_set
    if set_room and req.room_id is not None and not database.room_exists(req.room_id):
        raise HTTPException(status_code=400, detail="Pièce inconnue")
    sun_level = req.sun_level if "sun_level" in req.model_fields_set and req.sun_level is not None else None
    set_p1 = "p1_level" in req.model_fields_set
    set_p2 = "p2_level" in req.model_fields_set
    result = database.update_device_settings(
        id, req.custom_name, req.orientation, req.color, req.room_id, set_room,
        sun_level=sun_level,
        p1_level=req.p1_level, set_p1=set_p1,
        p2_level=req.p2_level, set_p2=set_p2,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Shutter config not found")
    await state_manager.refresh_config()
    return result


@app.post("/api/shutter-config/{id}/reassociate")
async def reassociate_shutter(id: int, req: ReassociateRequest):
    api_name = None
    with state_manager._lock:
        for s in state_manager.devices:
            if s.id == req.api_id:
                api_name = s.name
                break
    if api_name is None:
        raise HTTPException(status_code=404, detail="Shutter not found in live API state")
    try:
        result = database.reassociate_device(id, req.api_id, api_name)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await state_manager.update_state()
    return result


# --- Logs ---

@app.get("/api/logs")
def get_logs(page: int = 1, page_size: int = 50, level: Optional[str] = None):
    page_size = max(1, min(page_size, 200))
    return logs.read_logs(page=max(1, page), page_size=page_size, level=level)


# --- Notifications ---

@app.post("/api/notifications/test")
async def test_notification():
    channel = settings.notify_channel
    if channel == "email" and settings.smtp_host and settings.notify_email_to:
        ok = await notifications._send_email("Ceci est une notification de test.")
    else:
        raise HTTPException(status_code=400, detail="Aucun canal de notification configuré")
    if not ok:
        raise HTTPException(status_code=502, detail="Envoi échoué — vérifiez les logs serveur")
    return {"ok": True}


@app.get("/api/notifications/config")
def get_notification_config():
    return {
        "channel": settings.notify_channel if settings.notify_channel in ("none", "email") else "none",
        "email_enabled": bool(settings.notify_email_to),
        "smtp_configured": bool(settings.smtp_host),
    }


@app.put("/api/notifications/channel")
def update_channel(req: ChannelRequest):
    allowed = {"none", "email"}
    if req.channel not in allowed:
        raise HTTPException(status_code=400, detail=f"channel must be one of {allowed}")
    database.set_setting("NOTIFY_CHANNEL", req.channel)
    return {"ok": True}


@app.get("/api/notifications/smtp")
def get_smtp_config():
    return {
        "host": settings.smtp_host or "",
        "port": settings.smtp_port,
        "user": settings.smtp_user or "",
        "from_addr": settings.smtp_from or "",
        "email_to": settings.notify_email_to or "",
        "password_set": bool(settings.smtp_password),
    }


@app.put("/api/notifications/smtp")
def update_smtp_config(req: SmtpConfigRequest):
    database.set_setting("SMTP_HOST", req.host.strip())
    database.set_setting("SMTP_PORT", str(req.port))
    database.set_setting("SMTP_USER", req.user.strip())
    database.set_setting("SMTP_FROM", req.from_addr.strip())
    database.set_setting("NOTIFY_EMAIL_TO", req.email_to.strip())
    if req.password:
        database.set_setting("SMTP_PASSWORD", req.password)
    return {"ok": True}


# --- Interface web (build Angular servi par le backend : une seule adresse, pas de serveur de développement) ---

FRONTEND_DIST = Path(os.environ.get("CALHOME_FRONTEND_DIR") or ROOT / "frontend" / "dist" / "cal-home-alt-frontend" / "browser")


@app.get("/{path:path}", include_in_schema=False)
def serve_frontend(path: str):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    index = FRONTEND_DIST / "index.html"
    if not index.is_file():
        return JSONResponse(
            status_code=404,
            content={"detail": "Interface non construite : lancez « python run.py » (ou « npm run build » dans frontend/)."},
        )
    candidate = (FRONTEND_DIST / path).resolve()
    if path and candidate.is_file() and candidate.is_relative_to(FRONTEND_DIST.resolve()):
        return FileResponse(candidate)
    # index.html référence les fichiers par leur empreinte : il ne doit jamais rester en cache, sinon une mise à jour n'est pas vue.
    return FileResponse(index, headers={"Cache-Control": "no-cache"})   # routes de l'application (/plan, /settings…) : l'appli Angular les gère


if __name__ == "__main__":  # pragma: no cover
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9050)
