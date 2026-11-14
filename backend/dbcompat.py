"""Connexion SQLite de l'application.

Une connexion `sqlite3` ordinaire (lignes lisibles par nom, clés étrangères actives) avec trois aides pour le schéma :
`ddl()`, `has_table()` et `columns()`.
"""
from __future__ import annotations

import sqlite3


class Connection(sqlite3.Connection):
    def ddl(self, statement: str) -> None:
        """Une instruction de schéma (CREATE TABLE…)."""
        self.execute(statement)

    def has_table(self, table: str) -> bool:
        return self.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone() is not None

    def columns(self, table: str) -> set[str]:
        if not table.isidentifier():
            raise ValueError(f"nom de table invalide : {table!r}")
        return {r["name"] for r in self.execute(f"PRAGMA table_info({table})").fetchall()}  # nosec - nom validé ci-dessus


def connect(path: str) -> Connection:
    # timeout : le thread de lecture de la box et les requêtes de l'API écrivent parfois en même temps ; SQLite attend au lieu d'échouer.
    conn = sqlite3.connect(path, timeout=10, factory=Connection)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
