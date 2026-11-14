import json
import logging
from .api import box_tracker

_LOGGER = logging.getLogger(__name__)

_MOCK_SHUTTERS = [
    {"id": "mock-0001", "name": "Salon Sud",         "level": 0, "status": "open",   "hasTilt": False},
    {"id": "mock-0002", "name": "Chambre parents",      "level": 0, "status": "open",   "hasTilt": True, "tilt": 45},
    {"id": "mock-0003", "name": "Chambre 1",     "level": 0, "status": "open",   "hasTilt": False},
    {"id": "mock-0004", "name": "Chambre 2",     "level": 0, "status": "open",   "hasTilt": False},
    {"id": "mock-0005", "name": "Bureau Est",        "level": 0, "status": "open",   "hasTilt": True, "tilt": 0},
    {"id": "mock-0006", "name": "Cuisine Nord",      "level": 0, "status": "open",   "hasTilt": False},
    {"id": "mock-0007", "name": "Séjour Ouest",      "level": 0, "status": "open",   "hasTilt": False},
    {"id": "mock-0008", "name": "Entrée Nord-Est",   "level": 0, "status": "open",   "hasTilt": False},
]


def _level_to_status(level: int) -> str:
    if level <= 5:
        return "open"
    if level >= 95:
        return "close"
    return "middle"


class MockCalypsHomeAPI:
    """In-memory simulation of CalypsHomeAPI. No network calls, no real shutters."""

    def __init__(self):
        self._state: dict[str, dict] = {s["id"]: dict(s) for s in _MOCK_SHUTTERS}

    def get_objects(self) -> dict:
        with box_tracker.track("getObjects", target="mock", throttle=False):
            objects = []
            for sid, s in self._state.items():
                obj: dict = {
                    "id": sid,
                    "name": s["name"],
                    "type": "Rolling_Shutter",
                    "level": str(s["level"]),
                    "status": s["status"],
                    "hasTilt": s["hasTilt"],
                }
                if s["hasTilt"]:
                    obj["tilt"] = str(s.get("tilt", 0))
                objects.append(obj)
            return {"objects": objects}

    def _apply_level(self, device_id: str, level: int, action: str = "LEVEL") -> bool:
        with box_tracker.track(action, target=device_id, args=f"level={level}", throttle=False) as attempt:
            if device_id not in self._state:
                attempt.fail(f"Unknown device {device_id}")
                _LOGGER.warning(f"[MOCK] Unknown device {device_id}")
                return False
            self._state[device_id]["level"] = level
            self._state[device_id]["status"] = _level_to_status(level)
            _LOGGER.info(f"[MOCK] {device_id} → level={level}")
            return True

    def open_shutter(self, device_id: str) -> bool:
        return self._apply_level(device_id, 0, "OPEN")

    def close_shutter(self, device_id: str) -> bool:
        return self._apply_level(device_id, 100, "CLOSE")

    def stop_shutter(self, device_id: str) -> bool:
        with box_tracker.track("STOP", target=device_id, throttle=False):
            _LOGGER.info(f"[MOCK] {device_id} → STOP")
            return True

    def set_level(self, device_id: str, level: int) -> bool:
        return self._apply_level(device_id, level, "LEVEL")

    def set_tilt(self, device_id: str, angle: int) -> bool:
        with box_tracker.track("TILT", target=device_id, args=f"angle={angle}", throttle=False) as attempt:
            if device_id not in self._state:
                attempt.fail(f"Unknown device {device_id}")
                _LOGGER.warning(f"[MOCK] Unknown device {device_id}")
                return False
            self._state[device_id]["tilt"] = angle
            _LOGGER.info(f"[MOCK] {device_id} → tilt={angle}")
            return True

    def test_connection(self) -> dict:
        return self.get_objects()
