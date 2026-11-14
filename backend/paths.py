"""Emplacements des fichiers que l'application écrit (base SQLite, journaux).

Tout vit dans un seul dossier, `data/` à la racine du projet par défaut ; CALHOME_DATA_DIR le déplace (ex. un volume Docker).
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("CALHOME_DATA_DIR") or ROOT / "data")
DATA_DIR.mkdir(parents=True, exist_ok=True)
