import json
from typing import List

from . import database


def get_db():
    return database.get_db()


def init_db() -> None:
    database.init_db()


def get_all_schedules() -> List[dict]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM schedules ORDER BY id")
    rows = cursor.fetchall()
    conn.close()

    result = []
    for row in rows:
        d = dict(row)
        d["shutter_ids"] = json.loads(d["shutter_ids"])
        d["device_ids"] = d["shutter_ids"]  # nom attendu par le frontend (modèle générique)
        d["params"] = json.loads(d["params"]) if d["params"] else {}
        d["enabled"] = bool(d["enabled"])
        result.append(d)
    return result


def create_schedule(data: dict) -> dict:
    conn = get_db()
    cursor = conn.cursor()

    device_ids = json.dumps(data.get("device_ids", data.get("shutter_ids", [])))
    params = json.dumps(data.get("params", {}))

    cursor.execute(
        """
        INSERT INTO schedules (name, mode, shutter_ids, action, level, params, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            data["name"],
            data["mode"],
            device_ids,
            data["action"],
            data.get("level"),
            params,
            data.get("enabled", 1),
        ),
    )

    new_id = cursor.lastrowid
    conn.commit()
    conn.close()

    data["id"] = new_id
    return data


def update_schedule(schedule_id: int, data: dict) -> dict:
    conn = get_db()
    cursor = conn.cursor()

    fields = []
    values = []

    if "name" in data:
        fields.append("name = ?")
        values.append(data["name"])
    if "mode" in data:
        fields.append("mode = ?")
        values.append(data["mode"])
    if "device_ids" in data:
        fields.append("shutter_ids = ?")
        values.append(json.dumps(data["device_ids"]))
    elif "shutter_ids" in data:
        fields.append("shutter_ids = ?")
        values.append(json.dumps(data["shutter_ids"]))
    if "action" in data:
        fields.append("action = ?")
        values.append(data["action"])
    if "level" in data:
        fields.append("level = ?")
        values.append(data["level"])
    if "params" in data:
        fields.append("params = ?")
        values.append(json.dumps(data["params"]))
    if "enabled" in data:
        fields.append("enabled = ?")
        values.append(1 if data["enabled"] else 0)

    if not fields:
        return data

    values.append(schedule_id)
    cursor.execute(  # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query, python.lang.security.audit.formatted-sql-query.formatted-sql-query (colonnes issues de littéraux, valeurs paramétrées)
        f"UPDATE schedules SET {', '.join(fields)} WHERE id = ?", tuple(values)
    )
    conn.commit()
    conn.close()
    return data


def delete_schedule(schedule_id: int) -> None:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM schedule_executions WHERE schedule_id = ?", (schedule_id,))   # clé étrangère : l'historique part avec la programmation
    cursor.execute("DELETE FROM schedules WHERE id = ?", (schedule_id,))
    conn.commit()
    conn.close()


def toggle_schedule(schedule_id: int, enabled: bool) -> None:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE schedules SET enabled = ? WHERE id = ?",
        (1 if enabled else 0, schedule_id),
    )
    conn.commit()
    conn.close()


def log_execution(schedule_id: int, status: str, error: str | None = None) -> None:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO schedule_executions (schedule_id, status, error)
        VALUES (?, ?, ?)
        """,
        (schedule_id, status, error),
    )
    conn.commit()
    conn.close()


def get_executions(schedule_id: int) -> List[dict]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM schedule_executions WHERE schedule_id = ? ORDER BY executed_at DESC LIMIT 50",
        (schedule_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def detect_conflicts() -> List[dict]:
    return []
