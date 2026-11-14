"""Authentification intégrée (premier compte, connexion, comptes) et assistant de première configuration."""
import pytest
from fastapi.testclient import TestClient

from backend import auth, database
from backend.main import app


@pytest.fixture
def anon():
    auth._login_fails.clear()
    with TestClient(app) as c:
        yield c


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_first_run_creates_the_admin_account_once(anon):
    assert anon.get("/api/auth/status").json() == {"setup_required": True}
    r = anon.post("/api/auth/setup", json={"username": "Alice", "password": "un-bon-mot-de-passe"})
    assert r.status_code == 200
    token = r.json()["token"]
    assert anon.get("/api/auth/status").json() == {"setup_required": False}
    assert anon.get("/api/auth/me", headers=_bearer(token)).json() == {"username": "alice"}   # nom normalisé en minuscules
    # plus de création sauvage : le compte existe déjà
    again = anon.post("/api/auth/setup", json={"username": "mallory", "password": "un-autre-mot-de-passe"})
    assert again.status_code == 409
    assert database.list_users() == ["alice"]


@pytest.mark.parametrize("username,password", [("ab", "un-bon-mot-de-passe"), ("a b c", "un-bon-mot-de-passe"), ("alice", "court")])
def test_setup_validates_input(anon, username, password):
    assert anon.post("/api/auth/setup", json={"username": username, "password": password}).status_code == 400
    assert database.count_users() == 0


def test_login_with_username_and_password(anon):
    database.add_user("alice", auth.hash_password("un-bon-mot-de-passe"))
    ok = anon.post("/api/auth/login", json={"username": " ALICE ", "password": "un-bon-mot-de-passe"})
    assert ok.status_code == 200 and anon.get("/api/devices", headers=_bearer(ok.json()["token"])).status_code == 200
    assert anon.post("/api/auth/login", json={"username": "alice", "password": "faux"}).status_code == 401
    assert anon.post("/api/auth/login", json={"username": "inconnu", "password": "un-bon-mot-de-passe"}).status_code == 401


def test_a_deleted_account_loses_access_immediately(anon):
    database.add_user("alice", auth.hash_password("un-bon-mot-de-passe"))
    database.add_user("bob", auth.hash_password("un-bon-mot-de-passe"))
    alice, bob = auth.create_token("alice"), auth.create_token("bob")
    assert anon.delete("/api/auth/users/bob", headers=_bearer(alice)).status_code == 200
    assert anon.get("/api/devices", headers=_bearer(bob)).status_code == 401
    assert anon.post("/api/auth/refresh", headers=_bearer(bob)).status_code == 401


def test_user_management(anon):
    database.add_user("alice", auth.hash_password("un-bon-mot-de-passe"))
    h = _bearer(auth.create_token("alice"))
    assert anon.post("/api/auth/users", json={"username": "bob", "password": "mot-de-passe-de-bob"}, headers=h).status_code == 200
    assert anon.post("/api/auth/users", json={"username": "bob", "password": "mot-de-passe-de-bob"}, headers=h).status_code == 409
    assert anon.get("/api/auth/users", headers=h).json() == ["alice", "bob"]
    assert anon.delete("/api/auth/users/alice", headers=h).status_code == 409      # pas son propre compte
    assert anon.delete("/api/auth/users/zoe", headers=h).status_code == 404


def test_change_password(anon):
    database.add_user("alice", auth.hash_password("ancien-mot-de-passe"))
    h = _bearer(auth.create_token("alice"))
    assert anon.post("/api/auth/change-password", json={"current_password": "faux", "new_password": "nouveau-mot-de-passe"}, headers=h).status_code == 400
    assert anon.post("/api/auth/change-password", json={"current_password": "ancien-mot-de-passe", "new_password": "court"}, headers=h).status_code == 400
    assert anon.post("/api/auth/change-password", json={"current_password": "ancien-mot-de-passe", "new_password": "nouveau-mot-de-passe"}, headers=h).status_code == 200
    assert anon.post("/api/auth/login", json={"username": "alice", "password": "nouveau-mot-de-passe"}).status_code == 200
    assert anon.post("/api/auth/login", json={"username": "alice", "password": "ancien-mot-de-passe"}).status_code == 401


# --- Assistant de première configuration ---

@pytest.fixture
def client():
    database.add_user("alice", auth.hash_password("un-bon-mot-de-passe"))
    with TestClient(app, headers=_bearer(auth.create_token("alice"))) as c:
        yield c


def test_house_name_and_completion(client):
    assert client.get("/api/settings/house").json() == {"name": "", "setup_completed": False}
    assert client.put("/api/settings/house", json={"name": "  "}).status_code == 400
    assert client.put("/api/settings/house", json={"name": "Chez nous"}).status_code == 200
    assert client.post("/api/setup/complete").status_code == 200
    assert client.get("/api/settings/house").json() == {"name": "Chez nous", "setup_completed": True}


def test_rooms_are_laid_out_without_overlap_and_the_plan_grows(client):
    database.set_setting("HOUSE_NAME", "Chez nous")
    rooms = [client.post("/api/setup/rooms", json={"name": f"Pièce {i}"}).json() for i in range(10)]
    rects = [(r["x"], r["y"], r["width"], r["height"]) for r in rooms]
    for i, a in enumerate(rects):
        for b in rects[i + 1:]:
            assert not (a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]), (a, b)
    card = database.get_all_cards()[0]
    assert card["name"] == "Chez nous"
    height = float(card["view_box"].split()[3])
    assert height >= max(r[1] + r[3] for r in rects)                 # le plan contient toutes les pièces
    assert client.post("/api/setup/rooms", json={"name": " "}).status_code == 400


def test_a_deleted_room_slot_is_reused(client):
    first = client.post("/api/setup/rooms", json={"name": "A"}).json()
    client.post("/api/setup/rooms", json={"name": "B"})
    client.delete(f"/api/rooms/{first['id']}")
    again = client.post("/api/setup/rooms", json={"name": "C"}).json()
    assert (again["x"], again["y"]) == (first["x"], first["y"])


def test_autoplace_puts_classified_devices_inside_their_room(client):
    room = client.post("/api/setup/rooms", json={"name": "Salon"}).json()
    other = client.post("/api/setup/rooms", json={"name": "Cuisine"}).json()
    a = database.upsert_device("api-a", "Volet A")
    b = database.upsert_device("api-b", "Volet B")
    c = database.upsert_device("api-c", "Volet C")                    # sans pièce : n'est pas placé
    database.set_device_room(a["id"], room["id"])
    database.set_device_room(b["id"], room["id"])
    assert client.post("/api/setup/autoplace").json() == {"placed": 2}
    devices = {d["id"]: d for d in database.get_all_devices()}
    for dev in (devices[a["id"]], devices[b["id"]]):
        assert dev["card_id"] == room["card_id"]
        assert room["x"] < dev["x"] < room["x"] + room["width"] and room["y"] < dev["y"] < room["y"] + room["height"]
    assert devices[a["id"]]["x"] != devices[b["id"]]["x"]
    assert devices[c["id"]]["card_id"] is None
    assert client.post("/api/setup/autoplace").json() == {"placed": 0}   # idempotent
    assert other["id"]


def test_floorplan_starts_empty_with_a_neutral_card(client):
    plan = client.get("/api/floorplan").json()
    assert plan["rooms"] == [] and plan["devices"] == [] and plan["card"]["name"] == "Maison"


def test_frontend_routes_fall_back_to_index_or_explain(client, tmp_path, monkeypatch):
    import backend.main as m
    anon = TestClient(app)
    monkeypatch.setattr(m, "FRONTEND_DIST", tmp_path / "absent")
    assert anon.get("/plan").status_code == 404 and "run.py" in anon.get("/plan").json()["detail"]
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "main.js").write_text("console.log(1)")
    (tmp_path.parent / "secret.txt").write_text("secret")
    monkeypatch.setattr(m, "FRONTEND_DIST", tmp_path)
    assert anon.get("/plan").text == "<html>app</html>"
    assert anon.get("/main.js").text == "console.log(1)"
    assert anon.get("/../secret.txt").text == "<html>app</html>"          # jamais hors du dossier construit
    assert anon.get("/%2e%2e/secret.txt").text == "<html>app</html>"
    assert anon.get("/api/inconnu").status_code == 401                     # /api reste protégé, jamais servi par la SPA
