"""Client de l'API HTTP locale de la box Calyps'HOME.

Non officielle : l'API n'est pas documentée par le fabricant et peut changer à tout moment (voir DISCLAIMER.md).
Le principe de fonctionnement (cookies d'authentification, /m?a=getObjects, /m?a=command) a été découvert par saniho :
https://github.com/saniho/calypshome (voir NOTICE.md).
"""
from collections import deque
from contextlib import contextmanager
from datetime import datetime
import json
import logging
import os
import threading
import time
from typing import Callable, Optional
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

_LOGGER = logging.getLogger(__name__)

# Délai minimal (secondes) entre la fin d'une requête HTTP vers la box et le début de la suivante : 1 requête par seconde max.
# Le serveur HTTP embarqué de la box Calyps'HOME coupe les connexions (RST) s'il est sollicité en rafale ou en parallèle.
# Surchargeable via la variable d'environnement BOX_MIN_REQUEST_INTERVAL (secondes).
def _env_interval(default: float, name: str = "BOX_MIN_REQUEST_INTERVAL") -> float:
    try:
        return max(0.0, float(os.environ.get(name, default)))
    except ValueError:
        return default


_MIN_REQUEST_INTERVAL = _env_interval(1.0)
# Pause (secondes) imposée après une requête en échec : la box a besoin de souffler avant d'être resollicitée.
# Surchargeable via BOX_ERROR_COOLDOWN.
_ERROR_COOLDOWN = _env_interval(5.0, "BOX_ERROR_COOLDOWN")
_HISTORY_MAXLEN = 50


class _TrackedAttempt:
    def __init__(self) -> None:
        self.ok: bool = True
        self.error: Optional[str] = None

    def fail(self, error: str) -> None:
        self.ok = False
        self.error = error


class BoxRequestTracker:
    """Sérialise les requêtes HTTP vers la box, impose un délai minimal anti-spam et expose la file d'attente + les temps de réponse."""

    def __init__(self, min_interval: float = _MIN_REQUEST_INTERVAL, error_cooldown: float = _ERROR_COOLDOWN) -> None:
        self.min_interval = min_interval
        self.error_cooldown = error_cooldown
        self._last_failed = False
        self._exec_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._next_id = 1
        self._queued: dict[int, dict] = {}
        self._active: Optional[dict] = None
        self._history: deque[dict] = deque(maxlen=_HISTORY_MAXLEN)
        self._total_requests = 0
        self._total_errors = 0
        self._last_finished_mono = 0.0
        self._listeners: list[Callable[[], None]] = []

    def add_listener(self, cb: Callable[[], None]) -> None:
        with self._state_lock:
            if cb not in self._listeners:
                self._listeners.append(cb)

    def _notify(self) -> None:
        with self._state_lock:
            listeners = list(self._listeners)
        for cb in listeners:
            try:
                cb()
            except Exception:
                pass

    @contextmanager
    def track(self, op: str, target: Optional[str] = None, args: Optional[str] = None, throttle: bool = True):
        attempt = _TrackedAttempt()
        queued_mono = time.monotonic()
        queued_at = datetime.now().isoformat()

        with self._state_lock:
            req_id = self._next_id
            self._next_id += 1
            item = {
                "id": req_id,
                "op": op,
                "target": target,
                "args": args,
                "queued_at": queued_at,
                "_queued_mono": queued_mono,
            }
            self._queued[req_id] = item

        self._notify()

        with self._exec_lock:
            with self._state_lock:
                self._queued.pop(req_id, None)
                item["phase"] = "throttling"
                self._active = item

            if throttle and self._last_finished_mono > 0:
                delay = max(self.min_interval, self.error_cooldown) if self._last_failed else self.min_interval
                rem = delay - (time.monotonic() - self._last_finished_mono)
                if rem > 0:
                    self._notify()
                    time.sleep(rem)

            started_mono = time.monotonic()
            started_at = datetime.now().isoformat()
            wait_ms = max(0, round((started_mono - queued_mono) * 1000))
            with self._state_lock:
                item["phase"] = "http"
                item["started_at"] = started_at
                item["_started_mono"] = started_mono
                item["wait_ms"] = wait_ms

            self._notify()

            try:
                yield attempt
            except Exception as exc:
                attempt.fail(str(exc))
                raise
            finally:
                finished_mono = time.monotonic()
                if throttle:
                    self._last_finished_mono = finished_mono
                    self._last_failed = not attempt.ok
                duration_ms = max(0, round((finished_mono - started_mono) * 1000))
                completed = {
                    "id": req_id,
                    "op": op,
                    "target": target,
                    "args": args,
                    "queued_at": queued_at,
                    "started_at": started_at,
                    "finished_at": datetime.now().isoformat(),
                    "wait_ms": wait_ms,
                    "duration_ms": duration_ms,
                    "ok": attempt.ok,
                    "error": attempt.error,
                }
                with self._state_lock:
                    self._active = None
                    self._total_requests += 1
                    if not attempt.ok:
                        self._total_errors += 1
                    self._history.appendleft(completed)

                self._notify()

    def clear_history(self) -> None:
        with self._state_lock:
            self._history.clear()
            self._total_requests = 0
            self._total_errors = 0
        self._notify()

    def snapshot(self) -> dict:
        now_mono = time.monotonic()
        with self._state_lock:
            queued = [
                {
                    "id": q["id"],
                    "op": q["op"],
                    "target": q["target"],
                    "args": q["args"],
                    "queued_at": q["queued_at"],
                    "waiting_ms": max(0, round((now_mono - q["_queued_mono"]) * 1000)),
                }
                for q in self._queued.values()
            ]
            act = self._active
            active = (
                {
                    "id": act["id"],
                    "op": act["op"],
                    "target": act["target"],
                    "args": act["args"],
                    "phase": act.get("phase", "http"),
                    "queued_at": act["queued_at"],
                    "started_at": act.get("started_at"),
                    "wait_ms": act.get("wait_ms", max(0, round((now_mono - act["_queued_mono"]) * 1000))),
                    "elapsed_ms": max(0, round((now_mono - act.get("_started_mono", act["_queued_mono"])) * 1000)),
                }
                if act is not None
                else None
            )
            history = list(self._history)
            total_requests = self._total_requests
            total_errors = self._total_errors

        durations = [h["duration_ms"] for h in history if h.get("duration_ms") is not None]
        return {
            "queued": queued,
            "active": active,
            "stats": {
                "queued_count": len(queued),
                "in_progress": 1 if active is not None else 0,
                "last_response_ms": history[0]["duration_ms"] if history else None,
                "last_ok": history[0]["ok"] if history else None,
                "avg_response_ms": round(sum(durations) / len(durations)) if durations else None,
                "min_response_ms": min(durations) if durations else None,
                "max_response_ms": max(durations) if durations else None,
                "total_requests": total_requests,
                "total_errors": total_errors,
                "min_interval_ms": round(self.min_interval * 1000),
            },
            "history": history,
        }


box_tracker = BoxRequestTracker()


class CalypsHomeAPI:
    """Wrapper for Calyps'HOME Box API."""

    def __init__(self, host: str, login: str, password: str):
        self.host = host
        self.login = login
        self.password = password
        self._cookies = {
            "_server": f"http://{self.host}",
            "_login": self.login,
            "_password": self.password,
        }

    def _new_session(self) -> requests.Session:
        """Fresh session per call — avoids stale keep-alive connections.
        Note : ne JAMAIS forcer 'Connection: close' dans la requête HTTP vers la box :
        son serveur (libwebsockets HTTP/1.0) ferme alors le socket avant que le handler asynchrone /m n'ait écrit la réponse."""
        s = requests.Session()
        s.cookies.update(self._cookies)
        return s

    def get_objects(self) -> dict:
        """Fetch all objects from the box."""
        url = f"http://{self.host}/m?a=getObjects"
        with box_tracker.track("getObjects", target=self.host) as attempt:
            try:
                with self._new_session() as s:
                    resp = s.post(url, headers={"Accept": "application/json"}, verify=False, timeout=10)
                    resp.raise_for_status()
                    return resp.json()
            except Exception as e:
                attempt.fail(str(e))
                _LOGGER.error(f"Error fetching objects: {e}")
                return {}

    def _send_command(self, device_id: str, action: str, args: str = "") -> bool:
        """Send a command to a device."""
        url = f"http://{self.host}/m?a=command"
        payload = {
            "id": device_id,
            "action": action,
            "args": args
        }
        with box_tracker.track(action, target=device_id, args=args or None) as attempt:
            try:
                with self._new_session() as s:
                    resp = s.post(url, data=payload, headers={}, verify=False, timeout=10)
                    resp.raise_for_status()
                    return True
            except Exception as e:
                attempt.fail(str(e))
                _LOGGER.error(f"Error sending command {action} to {device_id}: {e}")
                return False

    def open_shutter(self, device_id: str) -> bool:
        return self._send_command(device_id, "OPEN")

    def close_shutter(self, device_id: str) -> bool:
        return self._send_command(device_id, "CLOSE")

    def stop_shutter(self, device_id: str) -> bool:
        return self._send_command(device_id, "STOP")

    def set_level(self, device_id: str, level: int) -> bool:
        return self._send_command(device_id, "LEVEL", json.dumps({"level": str(level)}))

    def set_tilt(self, device_id: str, angle: int) -> bool:
        return self._send_command(device_id, "TILT", json.dumps({"angle": str(angle)}))

    def test_connection(self) -> dict:
        """Test connectivity and auth. Raises on failure."""
        url = f"http://{self.host}/m?a=getObjects"
        with box_tracker.track("test", target=self.host):
            with self._new_session() as s:
                resp = s.post(url, headers={"Accept": "application/json"}, verify=False, timeout=5)
                resp.raise_for_status()
                return resp.json()
