import os
import secrets
import threading
import time
from pathlib import Path
from typing import Optional

import re

from . import dbcompat
from .paths import DATA_DIR

# CALHOME_DB_PATH : emplacement de la base SQLite ; par défaut data/calhome.db à la racine du projet.
DB_PATH = Path(os.environ.get("CALHOME_DB_PATH") or DATA_DIR / "calhome.db")

_DEFAULTS = {
    "CALYPS_HOST": "",
    "CALYPS_MAC": "",
    "CALYPS_LOGIN": "",
    "CALYPS_PASSWORD": "",
    "POLL_INTERVAL": "300",
    "LATITUDE": "48.8566",
    "LONGITUDE": "2.3522",
    "TIMEZONE": "Europe/Paris",
    "HOLIDAYS_COUNTRY": "FR",
    "NOTIFY_CHANNEL": "none",
    "NOTIFY_OPEN_AT_23H": "1",
    "SMTP_HOST": "",
    "SMTP_PORT": "",
    "SMTP_USER": "",
    "SMTP_PASSWORD": "",
    "SMTP_FROM": "",
    "NOTIFY_EMAIL_TO": "",
    "HOUSE_NAME": "",
    "SETUP_COMPLETED": "0",
}


def get_db() -> dbcompat.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return dbcompat.connect(str(DB_PATH))


def init_db() -> None:
    invalidate_settings_cache()
    conn = get_db()
    cursor = conn.cursor()

    conn.ddl("""
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        )
    """)

    conn.ddl("""
        CREATE TABLE IF NOT EXISTS schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            mode TEXT NOT NULL,
            shutter_ids TEXT NOT NULL,
            action TEXT NOT NULL,
            level INTEGER,
            params TEXT,
            enabled INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.ddl("""
        CREATE TABLE IF NOT EXISTS schedule_executions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            schedule_id INTEGER,
            executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT,
            error TEXT,
            FOREIGN KEY(schedule_id) REFERENCES schedules(id)
        )
    """)

    conn.ddl("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.ddl("""
        CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            view_box TEXT NOT NULL DEFAULT '0 0 900 600',
            north_angle REAL NOT NULL DEFAULT 0
        )
    """)

    conn.ddl("""
        CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL,
            width REAL NOT NULL,
            height REAL NOT NULL,
            FOREIGN KEY(card_id) REFERENCES cards(id)
        )
    """)

    conn.ddl("""
        CREATE TABLE IF NOT EXISTS devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            api_id TEXT UNIQUE NOT NULL,
            api_name TEXT NOT NULL,
            custom_name TEXT,
            type TEXT NOT NULL DEFAULT 'shutter',
            room_id INTEGER,
            card_id INTEGER,
            x REAL,
            y REAL,
            orientation INTEGER NOT NULL DEFAULT 180,
            color TEXT,
            extra_params TEXT,
            sun_level INTEGER NOT NULL DEFAULT 25,
            p1_level INTEGER,
            p2_level INTEGER,
            FOREIGN KEY(room_id) REFERENCES rooms(id),
            FOREIGN KEY(card_id) REFERENCES cards(id)
        )
    """)


    conn.commit()

    # Migrations
    if conn.has_table("shutter_configs"):
        if conn.has_table("devices"):
            # devices created empty by CREATE TABLE IF NOT EXISTS above — copy data then drop
            cursor.execute("""
                INSERT INTO devices (id, api_id, api_name, custom_name, orientation, color)
                SELECT id, api_id, api_name, custom_name, orientation, color FROM shutter_configs
            """)
            cursor.execute("DROP TABLE shutter_configs")
        else:
            cursor.execute("ALTER TABLE shutter_configs RENAME TO devices")
        conn.commit()

    cols = conn.columns("devices")
    if "type" not in cols:
        cursor.execute("ALTER TABLE devices ADD COLUMN type TEXT NOT NULL DEFAULT 'shutter'")
    if "room_id" not in cols:
        cursor.execute("ALTER TABLE devices ADD COLUMN room_id INTEGER")
    if "card_id" not in cols:
        cursor.execute("ALTER TABLE devices ADD COLUMN card_id INTEGER")
    if "extra_params" not in cols:
        cursor.execute("ALTER TABLE devices ADD COLUMN extra_params TEXT")
    if "x" not in cols:
        cursor.execute("ALTER TABLE devices ADD COLUMN x REAL")
    if "y" not in cols:
        cursor.execute("ALTER TABLE devices ADD COLUMN y REAL")
    if "sun_level" not in cols:
        cursor.execute("ALTER TABLE devices ADD COLUMN sun_level INTEGER NOT NULL DEFAULT 25")
    if "p1_level" not in cols:
        cursor.execute("ALTER TABLE devices ADD COLUMN p1_level INTEGER")
    if "p2_level" not in cols:
        cursor.execute("ALTER TABLE devices ADD COLUMN p2_level INTEGER")
    conn.commit()

    # JWT secret generated once, never overwritten
    cursor.execute("SELECT value FROM config WHERE key = 'JWT_SECRET'")
    if not cursor.fetchone():
        cursor.execute(
            "INSERT INTO config (key, value) VALUES ('JWT_SECRET', ?)",
            (secrets.token_hex(32),),
        )
        conn.commit()

    for key, default in _DEFAULTS.items():
        cursor.execute("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING", (key, default))
    conn.commit()
    conn.close()


# Réglages : la table config est lue d'un bloc puis servie depuis la mémoire (settings.<attr> est appelé très souvent).
# Invalidé à chaque écriture et par init_db ; TTL de sécurité si une autre instance écrivait en base.
_SETTINGS_TTL = 30.0
_settings_cache: dict[str, str] | None = None
_settings_cache_at = 0.0
_settings_lock = threading.Lock()


def invalidate_settings_cache() -> None:
    global _settings_cache
    with _settings_lock:
        _settings_cache = None


def _all_settings() -> dict[str, str]:
    global _settings_cache, _settings_cache_at
    with _settings_lock:
        if _settings_cache is not None and time.monotonic() - _settings_cache_at < _SETTINGS_TTL:
            return _settings_cache
    conn = get_db()
    try:
        rows = conn.cursor().execute("SELECT key, value FROM config").fetchall()
    finally:
        conn.close()
    data = {r["key"]: r["value"] for r in rows}
    with _settings_lock:
        _settings_cache, _settings_cache_at = data, time.monotonic()
    return data


def get_setting(key: str, default: str = "") -> str:
    data = _all_settings()
    return data[key] if key in data else default


def set_setting(key: str, value: str) -> None:
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            (key, value if value is not None else ""),
        )
        conn.commit()
    finally:
        conn.close()
    invalidate_settings_cache()


# --- Comptes (connexion intégrée) ---

USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,32}$")


def normalize_username(username: str) -> str:
    return (username or "").strip().lower()


def count_users() -> int:
    conn = get_db()
    try:
        return conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    finally:
        conn.close()


def get_user_hash(username: str) -> Optional[str]:
    conn = get_db()
    try:
        row = conn.execute("SELECT password_hash FROM users WHERE username = ?", (username,)).fetchone()
        return row["password_hash"] if row else None
    finally:
        conn.close()


def list_users() -> list[str]:
    conn = get_db()
    try:
        return [r["username"] for r in conn.execute("SELECT username FROM users ORDER BY username").fetchall()]
    finally:
        conn.close()


def create_first_user(username: str, password_hash: str) -> bool:
    """Crée le premier compte, seulement s'il n'en existe aucun (atomique : deux demandes simultanées ne créent qu'un compte)."""
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO users (username, password_hash) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)",
            (username, password_hash),
        )
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


def add_user(username: str, password_hash: str) -> bool:
    """False si ce nom existe déjà."""
    conn = get_db()
    try:
        cur = conn.execute("INSERT INTO users (username, password_hash) VALUES (?, ?) ON CONFLICT (username) DO NOTHING", (username, password_hash))
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


def set_user_password(username: str, password_hash: str) -> bool:
    conn = get_db()
    try:
        cur = conn.execute("UPDATE users SET password_hash = ? WHERE username = ?", (password_hash, username))
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


def delete_user(username: str) -> bool:
    conn = get_db()
    try:
        cur = conn.execute("DELETE FROM users WHERE username = ?", (username,))
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


def get_all_devices() -> list[dict]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM devices ORDER BY id")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def sync_devices(items: list[tuple[str, str, str]]) -> dict[str, dict]:
    """Enregistre en une seule connexion les appareils vus par la box (api_id, api_name, type) : crée les nouveaux, met à jour
    nom / type s'ils ont changé, n'écrit rien sinon. Retourne la ligne de chaque appareil, par api_id."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM devices")
        known = {r["api_id"]: dict(r) for r in cursor.fetchall()}
        dirty = False
        for api_id, api_name, dev_type in items:
            row = known.get(api_id)
            if row is None:
                cursor.execute("INSERT INTO devices (api_id, api_name, type) VALUES (?, ?, ?) ON CONFLICT (api_id) DO NOTHING",
                               (api_id, api_name, dev_type))
                dirty = True
            elif row["api_name"] != api_name or row["type"] != dev_type:
                cursor.execute("UPDATE devices SET api_name = ?, type = ? WHERE api_id = ?", (api_name, dev_type, api_id))
                dirty = True
        if dirty:
            conn.commit()
            cursor.execute("SELECT * FROM devices")
            known = {r["api_id"]: dict(r) for r in cursor.fetchall()}
        return known
    finally:
        conn.close()


def upsert_device(api_id: str, api_name: str, type: str = "shutter") -> dict:
    """Register a device from the API. Creates if not exists, updates api_name if changed."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO devices (api_id, api_name, type) VALUES (?, ?, ?) ON CONFLICT (api_id) DO NOTHING",
        (api_id, api_name, type),
    )
    cursor.execute(
        "UPDATE devices SET api_name = ?, type = ? WHERE api_id = ?",
        (api_name, type, api_id),
    )
    conn.commit()
    cursor.execute("SELECT * FROM devices WHERE api_id = ?", (api_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else {}


def update_device(
    device_id: int,
    custom_name: str | None,
    orientation: int,
    color: str | None = None,
    room_id: int | None = None,
    card_id: int | None = None,
    extra_params: str | None = None,
) -> dict:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE devices
        SET custom_name = ?, orientation = ?, color = ?, room_id = ?, card_id = ?, extra_params = ?
        WHERE id = ?
        """,
        (
            custom_name or None,
            orientation,
            color or None,
            room_id,
            card_id,
            extra_params,
            device_id,
        ),
    )
    conn.commit()
    cursor.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else {}


def update_device_settings(
    device_id: int,
    custom_name: str | None,
    orientation: int,
    color: str | None,
    room_id: int | None,
    set_room: bool,
    sun_level: int | None = None,
    p1_level: int | None = None,
    set_p1: bool = False,
    p2_level: int | None = None,
    set_p2: bool = False,
) -> dict:
    """Nom / orientation / couleur / pièce / raccourcis d'un appareil. Ne touche ni à la carte, ni à la position, ni aux paramètres (URL des appareils custom).
    room_id, p1_level, p2_level ne sont écrits que si leur indicateur set_* est vrai (None = effacer)."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE devices SET custom_name = ?, orientation = ?, color = ? WHERE id = ?",
            (custom_name or None, orientation, color or None, device_id),
        )
        if set_room:
            cursor.execute("UPDATE devices SET room_id = ? WHERE id = ?", (room_id, device_id))
        if sun_level is not None:
            cursor.execute("UPDATE devices SET sun_level = ? WHERE id = ?", (sun_level, device_id))
        if set_p1:
            cursor.execute("UPDATE devices SET p1_level = ? WHERE id = ?", (p1_level, device_id))
        if set_p2:
            cursor.execute("UPDATE devices SET p2_level = ? WHERE id = ?", (p2_level, device_id))
        conn.commit()
        cursor.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}
    finally:
        conn.close()


def set_device_room(device_id: int, room_id: int | None) -> bool:
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE devices SET room_id = ? WHERE id = ?", (room_id, device_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def get_all_rooms() -> list[dict]:
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT r.id, r.name, r.card_id, c.name AS card_name FROM rooms r JOIN cards c ON c.id = r.card_id ORDER BY c.id, r.name"
        )
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


def room_exists(room_id: int) -> bool:
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM rooms WHERE id = ?", (room_id,))
        return cursor.fetchone() is not None
    finally:
        conn.close()


def reassociate_device(device_id: int, new_api_id: str, new_api_name: str) -> dict:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id FROM devices WHERE api_id = ? AND id != ?",
        (new_api_id, device_id),
    )
    if cursor.fetchone():
        conn.close()
        raise ValueError(f"api_id {new_api_id} already assigned to another device")
    cursor.execute(
        "UPDATE devices SET api_id = ?, api_name = ? WHERE id = ?",
        (new_api_id, new_api_name, device_id),
    )
    conn.commit()
    cursor.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else {}


def update_device_placement(db_id: int, card_id: Optional[int], x: Optional[float], y: Optional[float]) -> dict:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE devices SET card_id = ?, x = ?, y = ? WHERE id = ?",
        (card_id, x, y, db_id),
    )
    conn.commit()
    cursor.execute("SELECT * FROM devices WHERE id = ?", (db_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else {}


# --- Cards & Rooms ---

def get_all_cards() -> list[dict]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM cards ORDER BY id")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_card(name: str, view_box: str = "0 0 900 600", north_angle: float = 0) -> dict:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO cards (name, view_box, north_angle) VALUES (?, ?, ?)",
        (name, view_box, north_angle),
    )
    new_id = cursor.lastrowid
    conn.commit()
    cursor.execute("SELECT * FROM cards WHERE id = ?", (new_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row)


def update_card(card_id: int, name: str, view_box: str, north_angle: float) -> dict:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE cards SET name = ?, view_box = ?, north_angle = ? WHERE id = ?",
        (name, view_box, north_angle, card_id),
    )
    conn.commit()
    cursor.execute("SELECT * FROM cards WHERE id = ?", (card_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row)


def delete_card(card_id: int) -> None:
    conn = get_db()
    cursor = conn.cursor()
    # Les pièces de la carte disparaissent avec elle ; les appareils qui y étaient posés repassent « non placés » (clés étrangères).
    cursor.execute("UPDATE devices SET room_id = NULL WHERE room_id IN (SELECT id FROM rooms WHERE card_id = ?)", (card_id,))
    cursor.execute("UPDATE devices SET card_id = NULL, x = NULL, y = NULL WHERE card_id = ?", (card_id,))
    cursor.execute("DELETE FROM rooms WHERE card_id = ?", (card_id,))
    cursor.execute("DELETE FROM cards WHERE id = ?", (card_id,))
    conn.commit()
    conn.close()


def get_rooms_by_card(card_id: int) -> list[dict]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM rooms WHERE card_id = ? ORDER BY id", (card_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_room(card_id: int, name: str, x: float, y: float, width: float, height: float) -> dict:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO rooms (card_id, name, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?)",
        (card_id, name, x, y, width, height),
    )
    new_id = cursor.lastrowid
    conn.commit()
    cursor.execute("SELECT * FROM rooms WHERE id = ?", (new_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row)


def update_room(room_id: int, card_id: int, name: str, x: float, y: float, width: float, height: float) -> dict:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE rooms SET card_id = ?, name = ?, x = ?, y = ?, width = ?, height = ? WHERE id = ?",
        (card_id, name, x, y, width, height, room_id),
    )
    conn.commit()
    cursor.execute("SELECT * FROM rooms WHERE id = ?", (room_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row)


def delete_room(room_id: int) -> None:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE devices SET room_id = NULL WHERE room_id = ?", (room_id,))
    cursor.execute("DELETE FROM rooms WHERE id = ?", (room_id,))
    conn.commit()
    conn.close()


# Auto-init on import so settings reads are always safe
init_db()
