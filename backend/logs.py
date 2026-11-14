import logging
import logging.handlers
import json
import os
from datetime import datetime
from typing import Optional

from .paths import DATA_DIR

APP_LOG = str(DATA_DIR / "app.log")
ACCESS_LOG = str(DATA_DIR / "access.log")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "ts": datetime.now().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if hasattr(record, "extra_data"):
            log_data["extra"] = record.extra_data
        return json.dumps(log_data)


def setup_logging() -> None:
    # App log
    handler = logging.handlers.RotatingFileHandler(
        APP_LOG, maxBytes=5 * 1024 * 1024, backupCount=3
    )
    handler.setFormatter(JsonFormatter())

    root_logger = logging.getLogger()
    root_logger.addHandler(handler)
    root_logger.setLevel(logging.INFO)

    # Specific logger for access logs
    access_handler = logging.handlers.RotatingFileHandler(
        ACCESS_LOG, maxBytes=5 * 1024 * 1024, backupCount=3
    )
    access_handler.setFormatter(JsonFormatter())
    access_logger = logging.getLogger("access")
    access_logger.addHandler(access_handler)
    access_logger.propagate = False


logger = logging.getLogger("app")
access_logger = logging.getLogger("access")


def _log_files() -> list[str]:
    """app.log puis ses rotations (app.log.1 = la plus récente après app.log), du plus récent au plus ancien."""
    files = [APP_LOG] + [f"{APP_LOG}.{i}" for i in range(1, 10)]
    return [f for f in files if os.path.exists(f)]


def read_logs(page: int = 1, page_size: int = 50, level: Optional[str] = None) -> dict:
    """Entrées de app.log, la plus récente d'abord, paginées. level : INFO / WARNING / ERROR (None ou ALL = tout)."""
    wanted = level.upper() if level and level.upper() != "ALL" else None
    start = (page - 1) * page_size
    items: list[dict] = []
    total = 0
    for path in _log_files():
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        except OSError:
            continue
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if wanted and entry.get("level") != wanted:
                continue
            if start <= total < start + page_size:
                items.append(entry)
            total += 1
    return {"items": items, "total": total, "page": page, "page_size": page_size}
