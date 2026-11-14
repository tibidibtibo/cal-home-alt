import asyncio
import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional, Set

import httpx
from .api import CalypsHomeAPI, box_tracker
from .config import settings
from . import database
from . import scheduler as app_scheduler

_LOGGER = logging.getLogger(__name__)

@dataclass
class DeviceState:
    id: str
    name: str
    type: str            # "shutter", "sensor", "camera", "custom_api"
    level: Optional[int] = None           # 0-100 for shutters
    status: Optional[str] = None          # "open", "closed", "motion", etc.
    is_closed: Optional[bool] = None
    has_tilt: bool = False
    tilt_angle: Optional[int] = None
    db_id: Optional[int] = None
    custom_name: Optional[str] = None
    orientation: int = 180
    room_id: Optional[int] = None
    card_id: Optional[int] = None
    x: Optional[float] = None
    y: Optional[float] = None
    extra_params: Optional[dict] = None
    next_action: Optional[dict] = None
    sun_level: int = 25
    p1_level: Optional[int] = None
    p2_level: Optional[int] = None

# Une lecture ratée isolée (timeout, box occupée) n'est pas une panne : on n'annonce « injoignable » qu'après plusieurs échecs d'affilée.
_UNREACHABLE_AFTER = 3


class StateManager:
    def __init__(self):
        if os.environ.get("CALYPS_MOCK", "").lower() in ("1", "true", "yes"):
            from .mock_api import MockCalypsHomeAPI
            self.api = MockCalypsHomeAPI()
            _LOGGER.info("Running with mock Calypshome API — no real commands will be sent")
        else:
            self.api = CalypsHomeAPI(settings.calyps_host, settings.calyps_login, settings.calyps_password)
        self.devices: List[DeviceState] = []
        self.id_map: Dict[str, str] = {}  # index -> real_id
        self.last_poll: Optional[datetime] = None   # dernière lecture RÉUSSIE de la box
        self.box_reachable: Optional[bool] = None   # None tant qu'aucune lecture n'a eu lieu (évite une fausse alerte au démarrage)
        self._failures = 0
        self.subscribers: Set[asyncio.Queue] = set()
        self._lock = threading.Lock()
        self._updating_lock = threading.Lock()
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self._refresh_task: Optional[asyncio.Task] = None
        self._rooms: Dict[int, str] = {}
        self._last_status: dict = {}
        box_tracker.add_listener(self._notify_box_queue)

    def _extract_status_field(self, shutter: dict, field: str):
        if field in shutter:
            return shutter[field]
        for item in shutter.get("status", []):
            if isinstance(item, dict) and item.get("name") == field:
                return item.get("value")
        return None

    def _wait_in_flight_update(self) -> None:
        with self._updating_lock:
            return

    async def update_state(self):
        """Poll the box and external APIs and update internal state.
        Si une lecture est déjà en cours, on attend sa fin au lieu d'envoyer un second getObjects simultané à la box."""
        if not self._updating_lock.acquire(blocking=False):
            await asyncio.to_thread(self._wait_in_flight_update)
            return
        try:
            await self._do_update_state()
        finally:
            self._updating_lock.release()

    async def _do_update_state(self):
        from . import notifications
        # 1. Calyps Box polling (blocking in thread pool)
        # to_thread : la boucle courante peut être celle du thread de polling (≠ self.loop), un Future d'une autre boucle planterait
        data = await asyncio.to_thread(self.api.get_objects)

        if data:
            self._failures = 0
            self.last_poll = datetime.now()
            if self.box_reachable is False:
                notifications.notify("box_reachable", "La connexion avec la box Calyps'HOME est rétablie.")
            self.box_reachable = True
        else:
            self._failures += 1
            _LOGGER.warning(f"Lecture de la box en échec ({self._failures}/{_UNREACHABLE_AFTER})")
            if self._failures >= _UNREACHABLE_AFTER and self.box_reachable is not False:
                if self.box_reachable is True:
                    notifications.notify("box_unreachable", "La box Calyps'HOME est injoignable.")
                self.box_reachable = False
        reachable = bool(data)

        new_devices = []
        new_id_map = {}

        # 1. Process Calyps Box objects
        raw_objects = [s for s in (data.get("objects", []) if data else []) if s.get("type") in ("Rolling_Shutter", "Door_Sensor")]
        configs = await asyncio.to_thread(
            database.sync_devices,
            [(s["id"], s["name"], "shutter" if s.get("type") == "Rolling_Shutter" else "sensor") for s in raw_objects],
        ) if raw_objects else {}
        for s in raw_objects:
            dev_type = "shutter" if s.get("type") == "Rolling_Shutter" else "sensor"

            level_raw = self._extract_status_field(s, "level")
            try:
                level = int(level_raw) if level_raw is not None else 0
            except (ValueError, TypeError):
                level = 0

            status = self._extract_status_field(s, "status") or "unknown"
            has_tilt_raw = self._extract_status_field(s, "hasTilt")
            has_tilt = has_tilt_raw in (True, "true", "True", 1, "1")

            tilt_angle = None
            if has_tilt:
                tilt_raw = self._extract_status_field(s, "tilt")
                try:
                    tilt_angle = int(tilt_raw) if tilt_raw is not None else 0
                except (ValueError, TypeError):
                    tilt_angle = 0

            config = configs.get(s["id"], {})

            state = DeviceState(
                id=s["id"],
                name=s["name"],
                type=dev_type,
                level=level if dev_type == "shutter" else None,
                status=status,
                is_closed=(status == "close"),
                has_tilt=has_tilt,
                tilt_angle=tilt_angle,
                db_id=config.get("id"),
                custom_name=config.get("custom_name") or None,
                orientation=config.get("orientation", 180),
                room_id=config.get("room_id"),
                card_id=config.get("card_id"),
                x=config.get("x"),
                y=config.get("y"),
                extra_params=json.loads(config["extra_params"]) if config.get("extra_params") else None,
                sun_level=config.get("sun_level") if config.get("sun_level") is not None else 25,
                p1_level=config.get("p1_level"),
                p2_level=config.get("p2_level"),
            )
            new_devices.append(state)

        db_devices = await asyncio.to_thread(database.get_all_devices)
        if not reachable:
            # Box injoignable : on garde le dernier état connu des appareils de la box (sinon la liste se vide et les index se décalent),
            # mais avec la configuration à jour (pièce, position, nom…) : elle vient de la base, pas de la box.
            by_api_id = {r["api_id"]: r for r in db_devices}
            kept = [d for d in self.devices if not d.id.startswith("custom-") and d.type != "custom_api"]
            for d in kept:
                self._apply_config(d, by_api_id.get(d.id))
            new_devices.extend(kept)

        # 2. Process Custom API devices from DB (Async polling)
        custom_devices = [d for d in db_devices if d["type"] == "custom_api"]

        async with httpx.AsyncClient() as client:
            tasks = []
            for d in custom_devices:
                params = json.loads(d["extra_params"]) if d["extra_params"] else {}
                url = params.get("url")
                if url:
                    tasks.append(self._poll_custom_device(client, d, url, params))

            if tasks:
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for i, res in enumerate(results):
                    if isinstance(res, DeviceState):
                        new_devices.append(res)
                    elif isinstance(res, Exception):
                        _LOGGER.error(f"Error polling custom device: {res}")
                        # Fallback state if poll fails
                        d = custom_devices[i]
                        params = json.loads(d["extra_params"]) if d["extra_params"] else {}
                        new_devices.append(DeviceState(
                            id=d["api_id"],
                            name=d["api_name"],
                            type=params.get("custom_type", "shutter"),
                            db_id=d["id"],
                            custom_name=d["custom_name"],
                            room_id=d["room_id"],
                            card_id=d["card_id"],
                            extra_params=params,
                        ))

        # 3. Enrich with Next Action
        next_actions = app_scheduler.get_next_actions() if hasattr(app_scheduler, "get_next_actions") else {}
        for i, dev in enumerate(new_devices):
            dev.next_action = next_actions.get(i)
            new_id_map[str(i)] = dev.id

        rooms = await asyncio.to_thread(self._load_rooms)
        status = {"box_reachable": self.box_reachable, "last_poll": self.last_poll.isoformat() if self.last_poll else None}
        with self._lock:
            changed = self.devices != new_devices or rooms != self._rooms
            status_changed = status["box_reachable"] != self._last_status.get("box_reachable")
            self._last_status = status
            self._rooms = rooms
            self.devices = new_devices
            self.id_map = new_id_map

        if changed:
            self._notify_clients()
        if status_changed:
            self._notify_status()

    @staticmethod
    def _apply_config(dev: DeviceState, row: Optional[dict]) -> None:
        """Reporte la configuration enregistrée en base (nom, pièce, position…) sur un appareil déjà en mémoire."""
        if not row:
            return
        dev.db_id = row.get("id")
        dev.custom_name = row.get("custom_name") or None
        dev.orientation = row.get("orientation", 180)
        dev.room_id = row.get("room_id")
        dev.card_id = row.get("card_id")
        dev.x = row.get("x")
        dev.y = row.get("y")
        if row.get("sun_level") is not None:
            dev.sun_level = row["sun_level"]
        dev.p1_level = row.get("p1_level")
        dev.p2_level = row.get("p2_level")
        if row.get("extra_params"):
            try:
                dev.extra_params = json.loads(row["extra_params"])
            except (ValueError, TypeError):
                pass

    async def refresh_config(self) -> None:
        """Répercute la configuration (pièce, position, nom, orientation) sur l'état en mémoire SANS interroger la box.
        À utiliser après une modification de configuration : instantané, et indépendant de la disponibilité de la box."""
        db_devices, rooms = await asyncio.gather(
            asyncio.to_thread(database.get_all_devices), asyncio.to_thread(self._load_rooms))
        by_api_id = {r["api_id"]: r for r in db_devices}
        with self._lock:
            before = [dict(vars(d)) for d in self.devices]
            for d in self.devices:
                self._apply_config(d, by_api_id.get(d.id))
            changed = before != [dict(vars(d)) for d in self.devices] or rooms != self._rooms
            self._rooms = rooms
        if changed:
            self._notify_clients()

    @staticmethod
    def _load_rooms() -> Dict[int, str]:
        conn = database.get_db()
        try:
            return {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM rooms").fetchall()}
        except Exception as e:
            _LOGGER.warning(f"Lecture des pièces impossible : {e}")
            return {}
        finally:
            conn.close()

    # Après une commande, la box met plusieurs dizaines de secondes à bouger : on relit son état à intervalles espacés
    # (pas de 0.0 s initial pour ne pas interroger la box pendant qu'elle émet l'ordre radio ou reçoit d'autres commandes groupées).
    _BURST_GAPS = (3.0, 5.0, 8.0, 12.0)

    def request_refresh(self, burst: bool = False) -> None:
        """Rafraîchit l'état en tâche de fond, sans faire attendre l'appelant. burst : plusieurs relectures espacées (suivi d'un mouvement).
        Une demande « burst » remplace la précédente ; une demande simple est ignorée si une actualisation est déjà en cours."""
        if self._refresh_task and not self._refresh_task.done():
            if not burst:
                return
            self._refresh_task.cancel()

        gaps = self._BURST_GAPS if burst else (0.0,)

        async def _run():
            try:
                for gap in gaps:
                    if gap:
                        await asyncio.sleep(gap)
                    await self.update_state()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                _LOGGER.error(f"Rafraîchissement après commande en échec : {e}")

        self._refresh_task = asyncio.get_running_loop().create_task(_run())

    def request_refresh_threadsafe(self) -> None:
        """Depuis un thread sans boucle (endpoints synchrones) : après un changement de pièces / cartes, on relit la configuration
        en base (pas la box : ce changement ne la concerne pas)."""
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self.refresh_config(), self.loop)

    def _notify_status(self) -> None:
        if not self.subscribers or not self.loop:
            return
        for q in list(self.subscribers):
            self.loop.call_soon_threadsafe(self._push, q, ("status", self._last_status))

    def get_box_queue_snapshot(self) -> dict:
        snap = box_tracker.snapshot()
        with self._lock:
            names = {d.id: (d.custom_name or d.name) for d in self.devices}
        for entry in snap["queued"]:
            if entry.get("target") in names:
                entry["target_name"] = names[entry["target"]]
        if snap["active"] and snap["active"].get("target") in names:
            snap["active"]["target_name"] = names[snap["active"]["target"]]
        for entry in snap["history"]:
            if entry.get("target") in names:
                entry["target_name"] = names[entry["target"]]
        snap["box_reachable"] = self.box_reachable
        snap["last_poll"] = self.last_poll.isoformat() if self.last_poll else None
        return snap

    def _notify_box_queue(self) -> None:
        if not self.subscribers or not self.loop or not self.loop.is_running():
            return
        snap = self.get_box_queue_snapshot()
        for q in list(self.subscribers):
            try:
                self.loop.call_soon_threadsafe(self._push, q, ("box_queue", snap))
            except RuntimeError:
                pass

    def _notify_clients(self):
        """Push update to all SSE subscribers."""
        if not self.subscribers or not self.loop:
            return

        data = ("devices", self.get_devices_dict())
        for q in list(self.subscribers):
            self.loop.call_soon_threadsafe(self._push, q, data)

    @staticmethod
    def _push(q: asyncio.Queue, data) -> None:
        """Les messages sont des instantanés complets : si le client est en retard, on jette le plus ancien."""
        if q.full():
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                pass
        q.put_nowait(data)

    def get_devices_dict(self) -> List[dict]:
        rooms = self._rooms
        with self._lock:
            return [
                {
                    "id": str(i),
                    "name": s.custom_name or s.name,
                    "api_name": s.name,
                    "type": s.type if s.type != "custom_api" else (s.extra_params.get("custom_type") if s.extra_params else "shutter"),
                    "level": s.level,
                    "status": s.status,
                    "is_closed": s.is_closed,
                    "has_tilt": s.has_tilt,
                    "tilt_angle": s.tilt_angle,
                    "api_id": s.id,
                    "db_id": s.db_id,
                    "orientation": s.orientation,
                    "room_id": s.room_id,
                    "room_name": rooms.get(s.room_id) if s.room_id else None,
                    "card_id": s.card_id,
                    "x": s.x,
                    "y": s.y,
                    "next_action": s.next_action,
                    "sun_level": s.sun_level,
                    "p1_level": s.p1_level,
                    "p2_level": s.p2_level,
                }
                for i, s in enumerate(self.devices)
            ]

    def get_shutter_orientation(self, index: str) -> Optional[int]:
        with self._lock:
            try:
                return self.devices[int(index)].orientation
            except (ValueError, IndexError):
                return None

    def get_real_id(self, index: str) -> Optional[str]:
        with self._lock:
            return self.id_map.get(index)

    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=50)
        self.subscribers.add(q)
        # Send current state immediately
        q.put_nowait(("status", self._last_status or {"box_reachable": self.box_reachable, "last_poll": None}))
        q.put_nowait(("devices", self.get_devices_dict()))
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self.subscribers.discard(q)

    async def _poll_custom_device(self, client: httpx.AsyncClient, d: dict, url: str, params: dict) -> DeviceState:
        resp = await client.get(url, timeout=5)
        resp.raise_for_status()
        api_data = resp.json()
        return DeviceState(
            id=d["api_id"],
            name=d["api_name"],
            type=params.get("custom_type", "shutter"),
            level=api_data.get("level"),
            status=api_data.get("status", "unknown"),
            db_id=d["id"],
            custom_name=d["custom_name"],
            room_id=d["room_id"],
            card_id=d["card_id"],
            extra_params=params,
        )

    def update_api_config(self, host: str) -> None:
        if isinstance(self.api, CalypsHomeAPI):
            self.api = CalypsHomeAPI(host, settings.calyps_login, settings.calyps_password)

    def update_api_creds(self, login: str, password: str) -> None:
        if isinstance(self.api, CalypsHomeAPI):
            self.api = CalypsHomeAPI(settings.calyps_host, login, password)

    def polling_thread(self):
        asyncio.run(self.polling_loop())

    async def polling_loop(self):
        backoff = settings.poll_interval
        while True:
            try:
                await self.update_state()
                if self.box_reachable:
                    backoff = settings.poll_interval
                else:
                    backoff = min(backoff * 2, 120)
            except Exception as e:
                _LOGGER.error(f"Error in polling loop: {e}")
                backoff = min(backoff * 2, 120)
            await asyncio.sleep(backoff)

state_manager = StateManager()
