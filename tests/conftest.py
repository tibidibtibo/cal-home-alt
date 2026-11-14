import os
import tempfile

# Avant tout import de backend : base et journaux dans un dossier jetable, jamais dans data/ (la vraie base locale).
_TMP = tempfile.mkdtemp(prefix="calhome-tests-")
os.environ["CALHOME_DATA_DIR"] = _TMP
os.environ["CALHOME_DB_PATH"] = os.path.join(_TMP, "test.db")

import pytest  # noqa: E402
from backend import database  # noqa: E402


@pytest.fixture(autouse=True)
def clean_db():
    if database.DB_PATH.exists():
        os.remove(database.DB_PATH)
    database.init_db()
    yield
    try:
        os.remove(database.DB_PATH)
    except OSError:
        pass


@pytest.fixture(autouse=True)
def no_background_polling(monkeypatch):
    """Le thread de polling lancé par le lifespan réécrirait devices / id_map pendant les tests : on le neutralise."""
    from backend.state import state_manager

    async def _noop():
        return None

    monkeypatch.setattr(state_manager, "polling_loop", _noop)
