import os
import json
import pytest
import time
import asyncio
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient
from backend.main import app
from backend.state import state_manager, DeviceState
from backend import schedules_db, auth, database, scheduler

_TEST_HASH = auth.hash_password("password123")


@pytest.fixture
def client():
    # La base est remise à zéro par tests/conftest.py (fichier jetable) : jamais par un chemin en dur.
    database.init_db()
    schedules_db.init_db()

    # Un compte existant et son jeton
    database.add_user("tester", _TEST_HASH)
    token = auth.create_token("tester")

    with TestClient(app) as c:
        c.headers["Authorization"] = f"Bearer {token}"
        yield c

def test_health(client):
    state_manager.box_reachable = True
    state_manager.last_poll = MagicMock()
    state_manager.last_poll.isoformat.return_value = "2024-01-01T00:00:00"
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

def test_get_shutters(client):
    state_manager.devices.clear()
    state_manager.devices.append(DeviceState("id1", "S1", "shutter", 50, "middle", False))
    resp = client.get("/api/devices")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1

def test_shutter_commands(client):
    state_manager.id_map.clear()
    state_manager.id_map.update({"0": "id1"})
    state_manager.devices.clear()
    state_manager.devices.append(DeviceState("id1", "S1", "shutter"))

    state_manager.api.open_shutter = MagicMock(return_value=True)
    state_manager.api.close_shutter = MagicMock(return_value=True)
    state_manager.api.stop_shutter = MagicMock(return_value=True)
    state_manager.api.set_level = MagicMock(return_value=True)
    state_manager.api.get_objects = MagicMock(return_value={"objects": [{"id": "id1", "name": "S1", "type": "Rolling_Shutter", "level": "0", "status": "open", "hasTilt": False}]})

    with patch.object(state_manager, "update_state", new_callable=AsyncMock):
        assert client.post("/api/devices/0/open").status_code == 200
        assert client.post("/api/devices/0/close").status_code == 200
        assert client.post("/api/devices/0/stop").status_code == 200
        assert client.post("/api/devices/0/level", json={"level": 50}).status_code == 200

    # Error cases: Shutter not found
    assert client.post("/api/devices/99/open").status_code == 404

    # Error cases: Box fail
    state_manager.api.open_shutter.return_value = False
    with patch.object(state_manager, "update_state", new_callable=AsyncMock):
        assert client.post("/api/devices/0/open").status_code == 502

def test_tilt_command(client):
    state_manager.id_map.clear(); state_manager.id_map.update({"0": "id1", "1": "id2"})
    state_manager.devices.clear(); state_manager.devices.extend([
        DeviceState("id1", "S1", "shutter", 100, "open", False, True, 0),
        DeviceState("id2", "S2", "shutter", 100, "open", False, False, None)
    ])
    state_manager.api.set_tilt = MagicMock(return_value=True)
    state_manager.api.get_objects = MagicMock(return_value={"objects": []})

    with patch.object(state_manager, "update_state", new_callable=AsyncMock):
        assert client.post("/api/devices/0/tilt", json={"angle": 45}).status_code == 200
        assert client.post("/api/devices/1/tilt", json={"angle": 45}).status_code == 400
        assert client.post("/api/devices/99/tilt", json={"angle": 45}).status_code == 404

def test_schedules_crud(client):
    payload = {
        "name": "Test",
        "mode": "fixed",
        "shutter_ids": [0],
        "action": "open",
        "params": {"time": "12:00", "days": "*" }
    }
    resp = client.post("/api/schedules", json=payload)
    assert resp.status_code == 200
    sched_id = resp.json()["id"]

    resp = client.get("/api/schedules")
    assert len(resp.json()) >= 1

    client.put(f"/api/schedules/{sched_id}", json={"name": "Updated", "mode": "presence", "shutter_ids": [0,1], "action": "close", "level": 0, "params": {}, "enabled": True})
    client.patch(f"/api/schedules/{sched_id}/toggle", json={"enabled": False})

    resp = client.get(f"/api/schedules/{sched_id}/executions")
    assert resp.status_code == 200
    client.get("/api/schedules/conflicts")
    client.delete(f"/api/schedules/{sched_id}")

def test_logs_and_notifications(client, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)          # /api/logs lit app.log dans le répertoire courant : jamais le vrai journal du dépôt
    with open("app.log", "w") as f:
        f.write(json.dumps({"level": "INFO", "timestamp": "2024-01-01", "message": "test"}) + "\n")
    resp = client.get("/api/logs")
    assert len(resp.json()) > 0

    assert client.get("/api/notifications/config").status_code == 200

    database.set_setting("NOTIFY_CHANNEL", "email")
    database.set_setting("SMTP_HOST", "localhost")
    database.set_setting("NOTIFY_EMAIL_TO", "test@test.com")
    with patch("backend.notifications._send_email", new_callable=AsyncMock) as mock_send:
        mock_send.return_value = True
        assert client.post("/api/notifications/test").status_code == 200

def test_events_sse(client):
    state_manager.loop = asyncio.get_event_loop_policy().new_event_loop()
    q = state_manager.subscribe()
    q.put_nowait([])
    with client.stream("GET", "/api/events") as response:
        assert response.status_code == 200
        # Just check it started
    state_manager.unsubscribe(q)

def test_sun_logic():
    from backend import sun
    from backend.config import settings
    settings.latitude = 48.8566
    settings.longitude = 2.3522
    assert sun.get_sun_event_time("sunrise") is not None
    sun.is_sun_in_range(0, 360, -90)
    sun.get_sun_times()
    sun.compute_daily_transitions(180, 60, 20)
    sun.is_bso_active(180, 60, 20)

def test_scheduler_execution():
    state_manager.id_map.clear(); state_manager.id_map.update({"0": "id1"})
    state_manager.devices.clear(); state_manager.devices.append(DeviceState("id1", "S1", "shutter"))
    state_manager.api.open_shutter = MagicMock(return_value=True)
    state_manager.api.get_objects = MagicMock(return_value={"objects": []})

    s1 = schedules_db.create_schedule({"name": "T1", "mode": "fixed", "shutter_ids": [0], "action": "open", "params": {}})

    loop = asyncio.get_event_loop_policy().new_event_loop()
    with patch.object(state_manager, "update_state", new_callable=AsyncMock):
        loop.run_until_complete(scheduler.execute_schedule(s1["id"]))

def test_state_manager_extra():
    sm = state_manager
    q = sm.subscribe()
    sm.unsubscribe(q)
    obj1 = {"id": "1", "name": "V1", "type": "Rolling_Shutter", "level": "0", "hasTilt": False}
    with patch.object(sm.api, "get_objects", return_value={"objects": [obj1]}):
        asyncio.run(sm.update_state())
        assert len(sm.devices) >= 1

def test_logs_json_formatter():
    from backend.logs import JsonFormatter
    import logging
    f = JsonFormatter()
    record = logging.LogRecord("name", logging.INFO, "path", 10, "msg", None, None)
    assert "msg" in f.format(record)

def test_main_lifespan():
    from backend.main import lifespan
    from fastapi import FastAPI
    app = FastAPI()
    async def run_lifespan():
        async with lifespan(app): pass
    loop = asyncio.get_event_loop_policy().new_event_loop()
    loop.run_until_complete(run_lifespan())


# --- Logs paginés ---

def test_read_logs_pagination(tmp_path, monkeypatch):
    from backend import logs
    log_path = str(tmp_path / "app.log")
    monkeypatch.setattr(logs, "APP_LOG", log_path)
    with open(log_path, "w") as f:
        for i in range(25):
            f.write(json.dumps({"ts": f"t{i}", "level": "ERROR" if i % 5 == 0 else "INFO", "logger": "x", "msg": f"m{i}"}) + "\n")
        f.write("ligne invalide\n")
    p1 = logs.read_logs(page=1, page_size=10)
    assert p1["total"] == 25 and p1["items"][0]["msg"] == "m24" and len(p1["items"]) == 10
    p3 = logs.read_logs(page=3, page_size=10)
    assert len(p3["items"]) == 5 and p3["items"][-1]["msg"] == "m0"
    err = logs.read_logs(level="ERROR")
    assert err["total"] == 5 and all(e["level"] == "ERROR" for e in err["items"])
    assert logs.read_logs(level="ALL")["total"] == 25


def test_shutter_config_room_assignment(client):
    """Catégoriser un volet (pièce) ; enregistrer le nom/orientation ne doit pas effacer pièce, carte ni paramètres."""
    card = database.create_card("Maison")
    room = database.create_room(card["id"], "Salon", 0, 0, 10, 10)
    dev = database.upsert_device("api-1", "Volet 1")
    database.update_device(dev["id"], None, 180, None, None, card["id"], '{"url": "http://x"}')

    assert any(r["id"] == room["id"] and r["card_name"] == "Maison" for r in client.get("/api/rooms").json())

    r = client.put(f"/api/shutter-config/{dev['id']}", json={"custom_name": "F salon", "orientation": 90, "room_id": room["id"]})
    assert r.status_code == 200 and r.json()["room_id"] == room["id"]

    # room_id absent : inchangé, et carte / extra_params conservés
    r = client.put(f"/api/shutter-config/{dev['id']}", json={"custom_name": "F salon 2", "orientation": 90})
    body = r.json()
    assert body["room_id"] == room["id"] and body["card_id"] == card["id"] and body["extra_params"] == '{"url": "http://x"}'

    # room_id null : pièce retirée
    assert client.put(f"/api/shutter-config/{dev['id']}", json={"orientation": 90, "room_id": None}).json()["room_id"] is None
    assert client.put(f"/api/shutter-config/{dev['id']}", json={"orientation": 90, "room_id": 9999}).status_code == 400


def test_shutter_config_shortcuts(client):
    """Mode soleil et positions favorites P1 / P2 : sauvegarde, conservation si omis, effacement si null, validation 0..100."""
    dev = database.upsert_device("api-shortcuts", "Volet raccourcis")
    assert dev["sun_level"] == 25
    assert dev["p1_level"] is None
    assert dev["p2_level"] is None

    r = client.put(f"/api/shutter-config/{dev['id']}", json={
        "orientation": 180, "sun_level": 35, "p1_level": 40, "p2_level": 80,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["sun_level"] == 35 and body["p1_level"] == 40 and body["p2_level"] == 80

    # Champs absents : valeurs conservées
    r = client.put(f"/api/shutter-config/{dev['id']}", json={"orientation": 180})
    assert r.status_code == 200
    body = r.json()
    assert body["sun_level"] == 35 and body["p1_level"] == 40 and body["p2_level"] == 80

    # Effacement de P1 uniquement
    r = client.put(f"/api/shutter-config/{dev['id']}", json={"orientation": 180, "p1_level": None})
    assert r.status_code == 200
    body = r.json()
    assert body["p1_level"] is None and body["p2_level"] == 80

    # Validation 0..100
    assert client.put(f"/api/shutter-config/{dev['id']}", json={"orientation": 180, "sun_level": 101}).status_code == 400
    assert client.put(f"/api/shutter-config/{dev['id']}", json={"orientation": 180, "p1_level": -1}).status_code == 400


def test_sse_ticket_single_use(client):
    t = client.post("/api/auth/sse-ticket").json()["ticket"]
    anon = TestClient(app)
    assert anon.get("/api/events?token=whatever").status_code == 401      # le JWT en URL n'est plus accepté
    assert anon.get("/api/events?ticket=bad").status_code == 401
    assert auth.consume_sse_ticket(t) is True
    assert auth.consume_sse_ticket(t) is False                             # usage unique
    assert anon.post("/api/auth/sse-ticket").status_code in (401, 403)


def test_refresh_session_is_bounded(client):
    import jwt as _jwt
    from datetime import datetime, timedelta, timezone
    secret = database.get_setting("JWT_SECRET")
    old = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp())
    tok = _jwt.encode({"sub": "tester", "exp": datetime.now(timezone.utc) + timedelta(hours=1), "auth_time": old}, secret, algorithm="HS256")
    assert client.post("/api/auth/refresh", headers={"Authorization": f"Bearer {tok}"}).status_code == 401
    fresh = auth.create_token("tester")
    r = client.post("/api/auth/refresh", headers={"Authorization": f"Bearer {fresh}"})
    assert r.status_code == 200 and r.json()["token"]


def test_login_rate_limit(client):
    auth._login_fails.clear()
    for _ in range(5):
        assert client.post("/api/auth/login", json={"username": "tester", "password": "faux"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "tester", "password": "password123"}).status_code == 429
    auth._login_fails.clear()
    assert client.post("/api/auth/login", json={"username": "tester", "password": "password123"}).status_code == 200


def test_schedule_validation(client):
    assert client.post("/api/schedules", json={"name": "x", "mode": "nope", "action": "open"}).status_code == 422
    assert client.post("/api/schedules", json={"name": "x", "mode": "fixed", "action": "level", "level": 500}).status_code == 422
    assert client.post("/api/schedules", json={"mode": "fixed", "action": "open"}).status_code == 422
    ok = client.post("/api/schedules", json={"name": "x", "mode": "fixed", "action": "open", "device_ids": [0], "params": {"time": "07:00"}})
    assert ok.status_code == 200


def test_sync_devices_only_writes_on_change():
    items = [("a", "Volet A", "shutter"), ("b", "Volet B", "shutter")]
    first = database.sync_devices(items)
    assert set(first) == {"a", "b"}
    database.update_device(first["a"]["id"], "Salon", 90, None, None, None, None)
    again = database.sync_devices(items)
    assert again["a"]["custom_name"] == "Salon" and again["a"]["id"] == first["a"]["id"]
    renamed = database.sync_devices([("a", "Volet A2", "shutter")])
    assert renamed["a"]["api_name"] == "Volet A2" and renamed["a"]["custom_name"] == "Salon"


def test_settings_cache_invalidated_on_write():
    assert database.get_setting("TIMEZONE") == "Europe/Paris"
    database.set_setting("TIMEZONE", "UTC")
    assert database.get_setting("TIMEZONE") == "UTC"
    assert database.get_setting("ABSENT", "d") == "d"


def test_check_open_at_23h_does_not_await_notify():
    from backend import scheduler as sch
    state_manager.devices.clear()
    state_manager.devices.append(DeviceState("id1", "S1", "shutter", level=0))
    with patch("backend.notifications.notify") as n:
        asyncio.new_event_loop().run_until_complete(sch.check_open_at_23h())
    n.assert_called_once()


def test_device_room_endpoint(client):
    card = database.create_card("Maison")
    room = database.create_room(card["id"], "Salon", 0, 0, 10, 10)
    dev = database.upsert_device("api-9", "Volet 9")
    with patch.object(state_manager, "update_state", new=AsyncMock()):
        assert client.put(f"/api/devices/{dev['id']}/room", json={"room_id": room["id"]}).status_code == 200
        assert database.get_all_devices()[0]["room_id"] == room["id"]
        assert client.put(f"/api/devices/{dev['id']}/room", json={"room_id": 999}).status_code == 400
        assert client.put("/api/devices/12345/room", json={"room_id": None}).status_code == 404
        assert client.put(f"/api/devices/{dev['id']}/room", json={"room_id": None}).status_code == 200
    assert database.get_all_devices()[0]["room_id"] is None


def _poll_failing(n):
    for _ in range(n):
        with patch.object(state_manager.api, "get_objects", return_value={}):
            asyncio.new_event_loop().run_until_complete(state_manager.update_state())


def test_box_unreachable_keeps_last_known_devices():
    state_manager.devices.clear()
    state_manager.devices.append(DeviceState("id1", "S1", "shutter", level=40))
    state_manager.box_reachable, state_manager._failures = True, 0
    _poll_failing(3)
    assert [d.id for d in state_manager.devices] == ["id1"] and state_manager.box_reachable is False


def test_single_box_failure_is_not_an_outage():
    state_manager.devices.clear()
    state_manager.devices.append(DeviceState("id1", "S1", "shutter", level=40))
    state_manager.box_reachable, state_manager._failures = True, 0
    _poll_failing(2)
    assert state_manager.box_reachable is True
    with patch.object(state_manager.api, "get_objects", return_value={"objects": []}):
        asyncio.new_event_loop().run_until_complete(state_manager.update_state())
    assert state_manager.box_reachable is True and state_manager._failures == 0


def test_config_changes_are_reflected_while_box_unreachable(client):
    room = database.create_card("C"), None
    card = room[0]
    r = database.create_room(card["id"], "Salon", 0, 0, 10, 10)
    dev = database.upsert_device("id1", "S1", "shutter")
    state_manager.devices.clear()
    state_manager.devices.append(DeviceState("id1", "S1", "shutter", level=40, db_id=dev["id"]))
    state_manager.box_reachable, state_manager._failures = False, 5
    assert client.put(f"/api/devices/{dev['id']}/room", json={"room_id": r["id"]}).status_code == 200
    assert client.put(f"/api/devices/{dev['id']}/placement", json={"card_id": card["id"], "x": 40, "y": 60}).status_code == 200
    d = client.get("/api/devices").json()[0]
    assert (d["room_id"], d["room_name"], d["card_id"], d["x"], d["y"]) == (r["id"], "Salon", card["id"], 40, 60)
    # même chose via un sondage raté : la config vient de la base, pas de l'état gardé en mémoire
    _poll_failing(1)
    d = client.get("/api/devices").json()[0]
    assert (d["room_name"], d["x"]) == ("Salon", 40)


def test_sse_stream_sends_status_and_devices(client):
    state_manager.loop = asyncio.get_event_loop_policy().new_event_loop()
    q = state_manager.subscribe()
    first, second = q.get_nowait(), q.get_nowait()
    state_manager.unsubscribe(q)
    assert first[0] == "status" and "box_reachable" in first[1]
    assert second[0] == "devices" and isinstance(second[1], list)


def test_burst_refresh_replaces_previous(monkeypatch):
    calls = []

    async def fake_update():
        calls.append(1)

    monkeypatch.setattr(state_manager, "update_state", fake_update)
    monkeypatch.setattr(state_manager, "_BURST_GAPS", (0.0, 0.01, 0.01))

    async def run():
        state_manager.request_refresh(burst=True)
        await asyncio.sleep(0.1)

    asyncio.new_event_loop().run_until_complete(run())
    assert len(calls) == 3


def test_auth_admin_routes_require_a_token():
    anon = TestClient(app)
    for method, path in [("get", "/api/auth/users"), ("post", "/api/auth/users"), ("delete", "/api/auth/users/bob"),
                         ("post", "/api/auth/change-password"), ("post", "/api/auth/sse-ticket"), ("get", "/api/auth/me"),
                         ("put", "/api/settings/house"), ("post", "/api/setup/complete"), ("post", "/api/setup/rooms")]:
        assert getattr(anon, method)(path).status_code == 401, path
    assert anon.get("/api/auth/status").status_code == 200


def test_box_ping_and_test_errors(client):
    import requests as req

    # Sans IP configurée : 400
    database.set_setting("CALYPS_HOST", "")
    assert client.post("/api/box/ping").status_code == 400

    database.set_setting("CALYPS_HOST", "192.168.1.50")

    # Serveur HTTP répond (même 404) -> OK
    with patch("backend.main._requests.get", return_value=MagicMock(status_code=404)):
        r = client.post("/api/box/ping")
        assert r.status_code == 200 and r.json() == {"ok": True}

    # Port ouvert mais serveur HTTP qui reset la connexion (RST) -> 502 message explicite
    rst = req.exceptions.ConnectionError("Connection aborted.", ConnectionResetError(104, "Connection reset by peer"))
    with patch("backend.main._requests.get", side_effect=rst):
        r = client.post("/api/box/ping")
        assert r.status_code == 502
        assert "serveur HTTP a coupé" in r.json()["detail"]

    with patch.object(state_manager.api, "test_connection", side_effect=rst):
        r = client.post("/api/box/test")
        assert r.status_code == 502
        assert "serveur HTTP a coupé" in r.json()["detail"]

    # Port 80 fermé (ECONNREFUSED : démon HTTP arrêté sur la box) -> 502 message explicite port 80
    refused = req.exceptions.ConnectionError("Connection refused", ConnectionRefusedError(111, "Connection refused"))
    with patch("backend.main._requests.get", side_effect=refused):
        r = client.post("/api/box/ping")
        assert r.status_code == 502
        assert "port HTTP (80) est fermé" in r.json()["detail"]

    # IP injoignable -> 502 message IP
    with patch.object(state_manager.api, "test_connection", side_effect=req.exceptions.ConnectionError("No route to host")):
        r = client.post("/api/box/test")
        assert r.status_code == 502
        assert "adresse IP" in r.json()["detail"]

    # Timeout -> 504
    with patch("backend.main._requests.get", side_effect=req.exceptions.Timeout("timed out")):
        assert client.post("/api/box/ping").status_code == 504


def test_box_tracker_error_cooldown():
    from backend.api import BoxRequestTracker

    tracker = BoxRequestTracker(min_interval=0.05, error_cooldown=0.3)
    with tracker.track("getObjects", target="box") as attempt:
        attempt.fail("RemoteDisconnected")
    t0 = time.monotonic()
    with tracker.track("getObjects", target="box"):
        pass
    assert time.monotonic() - t0 >= 0.28  # pause après erreur

    t0 = time.monotonic()
    with tracker.track("getObjects", target="box"):
        pass
    elapsed = time.monotonic() - t0
    assert 0.04 <= elapsed < 0.25  # retour au délai normal après un succès


def test_box_tracker_serialization_and_queue_endpoint(client):
    import threading
    from backend.api import BoxRequestTracker, CalypsHomeAPI, box_tracker

    api = CalypsHomeAPI("192.168.1.50", "u", "p")
    with api._new_session() as s:
        assert s.headers.get("Connection") != "close"

    tracker = BoxRequestTracker(min_interval=0.05)
    active_seen = []
    queued_seen = []
    entered = threading.Event()
    release = threading.Event()

    def worker1():
        with tracker.track("OPEN", target="id1"):
            entered.set()
            release.wait(timeout=2)

    def worker2():
        entered.wait(timeout=2)
        with tracker.track("CLOSE", target="id2"):
            snap = tracker.snapshot()
            active_seen.append(snap["active"]["op"] if snap["active"] else None)

    t1 = threading.Thread(target=worker1)
    t2 = threading.Thread(target=worker2)
    t1.start()
    entered.wait(timeout=2)
    t2.start()

    # Wait briefly for worker2 to enqueue
    for _ in range(20):
        snap = tracker.snapshot()
        if snap["queued"]:
            queued_seen = [q["op"] for q in snap["queued"]]
            break
        time.sleep(0.01)

    assert snap["active"]["op"] == "OPEN"
    assert queued_seen == ["CLOSE"]

    release.set()
    t1.join(timeout=2)
    t2.join(timeout=2)

    final = tracker.snapshot()
    assert final["active"] is None
    assert final["queued"] == []
    assert final["stats"]["total_requests"] == 2
    assert [h["op"] for h in final["history"]] == ["CLOSE", "OPEN"]

    # Endpoint /api/box/queue & DELETE /api/box/queue/history
    state_manager.devices.clear()
    state_manager.devices.append(DeviceState("id1", "Salon Sud", "shutter", level=50))
    with box_tracker.track("OPEN", target="id1", throttle=False):
        pass
    r = client.get("/api/box/queue")
    assert r.status_code == 200
    body = r.json()
    assert body["stats"]["total_requests"] >= 1
    assert body["history"][0]["target_name"] == "Salon Sud"

    assert client.delete("/api/box/queue/history").status_code == 200
    assert client.get("/api/box/queue").json()["history"] == []


def test_update_state_coalesces_concurrent_calls():
    calls = 0

    def slow_get_objects():
        nonlocal calls
        calls += 1
        time.sleep(0.08)
        return {"objects": []}

    with patch.object(state_manager.api, "get_objects", side_effect=slow_get_objects):
        async def run_both():
            await asyncio.gather(state_manager.update_state(), state_manager.update_state())

        asyncio.new_event_loop().run_until_complete(run_both())

    assert calls == 1


def test_sun_times_endpoint(client):
    r = client.get("/api/sun/times")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"sunrise", "sunset", "timezone", "day_type", "holiday"}
    assert body["sunrise"] < body["sunset"]
    assert client.get("/api/sun/times?date=2026-06-21").json()["sunset"] > "20:00"
    assert client.get("/api/sun/times?date=nope").status_code == 400


def test_presence_schedule_validation(client):
    base = {"name": "Soir", "mode": "presence", "shutter_ids": [0], "action": "close"}
    ok = client.post("/api/schedules", json={**base, "params": {"sun_event": "sunset", "offset_min": -15}})
    assert ok.status_code == 200
    assert client.post("/api/schedules", json={**base, "params": {"sun_event": "noon", "offset_min": 0}}).status_code == 422
    assert client.post("/api/schedules", json={**base, "params": {"sun_event": "sunset", "offset_min": "x"}}).status_code == 422
    assert client.post("/api/schedules", json={**base, "params": {"sun_event": "sunset", "offset_min": 9999}}).status_code == 422


def test_day_type_weekday_weekend_holiday():
    from datetime import date
    from backend import sun
    assert sun.get_day_type(date(2026, 11, 13))["day_type"] == "weekday"       # vendredi
    assert sun.get_day_type(date(2026, 11, 14))["day_type"] == "weekend"       # samedi
    ferie = sun.get_day_type(date(2026, 11, 11))                               # Armistice, mercredi
    assert ferie["day_type"] == "holiday" and ferie["holiday"]
    assert sun.get_day_type(date(2026, 12, 25))["day_type"] == "holiday"


def test_absence_events_open_time_and_close_offset():
    from datetime import date, timedelta
    from backend import sun
    params = {"open_weekday": "08:00", "open_weekend": "09:30", "close_offset_min": 10}
    sunset = sun.get_sun_event_time("sunset")
    for d, expected in ((date(2026, 11, 13), "08:00"), (date(2026, 11, 14), "09:30"), (date(2026, 11, 11), "09:30")):
        ev = sun.get_absence_events(params, d)
        assert [e["action"] for e in ev] == ["open", "close"]
        assert ev[0]["time"].strftime("%H:%M") == expected
        assert ev[1]["time"] > ev[0]["time"]
    ev = sun.get_absence_events(params, sunset.date())
    assert ev[1]["time"] == sunset + timedelta(minutes=10)


def test_absence_schedule_validation_and_execution(client):
    base = {"name": "Absence", "mode": "absence", "shutter_ids": [0], "action": "open"}
    good = {"open_weekday": "08:00", "open_weekend": "09:30", "close_offset_min": 10}
    assert client.post("/api/schedules", json={**base, "params": good}).status_code == 200
    assert client.post("/api/schedules", json={**base, "params": {**good, "open_weekday": "25:00"}}).status_code == 422
    assert client.post("/api/schedules", json={**base, "params": {**good, "open_weekend": "9h30"}}).status_code == 422
    assert client.post("/api/schedules", json={**base, "params": {**good, "close_offset_min": "x"}}).status_code == 422


def test_absence_next_actions_and_override(client):
    sched = client.post("/api/schedules", json={
        "name": "Absence", "mode": "absence", "shutter_ids": [0], "action": "open",
        "params": {"open_weekday": "08:00", "open_weekend": "09:30", "close_offset_min": 10},
    }).json()
    nxt = scheduler.get_next_actions()
    assert 0 in nxt and nxt[0]["schedule_name"] == "Absence" and nxt[0]["action"] in ("open", "close")
    assert sched["id"]


def test_execute_schedule_action_override():
    state_manager.id_map.clear(); state_manager.id_map.update({"0": "id1"})
    state_manager.devices.clear(); state_manager.devices.append(DeviceState("id1", "S1", "shutter"))
    state_manager.api.open_shutter = MagicMock(return_value=True)
    state_manager.api.close_shutter = MagicMock(return_value=True)
    s1 = schedules_db.create_schedule({"name": "Abs", "mode": "absence", "shutter_ids": [0], "action": "open", "params": {}})
    loop = asyncio.get_event_loop_policy().new_event_loop()
    with patch.object(state_manager, "update_state", new_callable=AsyncMock):
        loop.run_until_complete(scheduler.execute_schedule(s1["id"], "close"))
    state_manager.api.close_shutter.assert_called_once_with("id1")
    state_manager.api.open_shutter.assert_not_called()


# --- Planning du jour (/api/plan) ---

def test_day_plan_reflects_enabled_schedules(client):
    soir = client.post("/api/schedules", json={
        "name": "Soir", "mode": "presence", "shutter_ids": [0], "action": "close",
        "params": {"sun_event": "sunset", "offset_min": 20},
    }).json()
    plan = client.get("/api/plan?date=2026-11-13").json()
    assert plan["date"] == "2026-11-13" and plan["sunset"]
    assert [e["schedule_name"] for e in plan["events"]] == ["Soir"]
    ev = plan["events"][0]
    assert ev["action"] == "close" and ev["mode"] == "presence" and ev["time"].startswith("2026-11-13T")

    # désactivation -> disparaît, réactivation -> revient
    client.patch(f"/api/schedules/{soir['id']}/toggle", json={"enabled": False})
    assert client.get("/api/plan?date=2026-11-13").json()["events"] == []
    client.patch(f"/api/schedules/{soir['id']}/toggle", json={"enabled": True})
    assert len(client.get("/api/plan?date=2026-11-13").json()["events"]) == 1


def test_day_plan_fixed_days_and_absence(client):
    # UI : 1=lundi..7=dimanche. 2026-11-13 = vendredi, 2026-11-14 = samedi.
    client.post("/api/schedules", json={
        "name": "Semaine", "mode": "fixed", "shutter_ids": [0], "action": "close",
        "params": {"time": "22:00", "days": "1,2,3,4,5"},
    })
    client.post("/api/schedules", json={
        "name": "Absence", "mode": "absence", "shutter_ids": [0], "action": "open",
        "params": {"open_weekday": "08:00", "open_weekend": "09:30", "close_offset_min": 10},
    })
    fri = client.get("/api/plan?date=2026-11-13").json()["events"]
    sat = client.get("/api/plan?date=2026-11-14").json()["events"]
    assert [e["schedule_name"] for e in fri].count("Semaine") == 1
    assert [e["schedule_name"] for e in sat].count("Semaine") == 0
    assert [e["time"][11:16] for e in fri if e["schedule_name"] == "Absence" and e["action"] == "open"] == ["08:00"]
    assert [e["time"][11:16] for e in sat if e["schedule_name"] == "Absence" and e["action"] == "open"] == ["09:30"]
    assert [e["time"] for e in fri] == sorted(e["time"] for e in fri)


def test_day_plan_bad_date(client):
    assert client.get("/api/plan?date=nope").status_code == 400


def test_parse_fixed_days():
    assert scheduler.parse_fixed_days("1,2,3,4,5") == [0, 1, 2, 3, 4]
    assert scheduler.parse_fixed_days("7") == [6]
    assert scheduler.parse_fixed_days("*") is None and scheduler.parse_fixed_days(None) is None
    assert scheduler.parse_fixed_days("9,x") == []
