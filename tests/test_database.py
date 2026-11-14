"""La couche base (SQLite) de Cal-Home Alt."""
import json

from backend import database, schedules_db


def test_settings_are_upserted_and_defaults_exist():
    assert database.get_setting("TIMEZONE") == "Europe/Paris"
    database.set_setting("CALYPS_HOST", "192.168.1.50")
    database.set_setting("CALYPS_HOST", "192.168.1.51")      # même clé : mise à jour, pas de doublon ni d'erreur
    assert database.get_setting("CALYPS_HOST") == "192.168.1.51"
    database.set_setting("SMTP_HOST", None)
    assert database.get_setting("SMTP_HOST") == ""
    assert database.get_setting("ABSENT", "défaut") == "défaut"
    assert len(database.get_setting("JWT_SECRET")) == 64     # généré une fois, jamais réécrit
    database.init_db()
    assert len(database.get_setting("JWT_SECRET")) == 64


def test_users_first_account_is_created_once_and_names_are_unique():
    assert database.count_users() == 0
    assert database.create_first_user("alice", "h1") is True
    assert database.create_first_user("mallory", "h2") is False          # refusé dès qu'un compte existe
    assert database.add_user("bob", "h3") is True
    assert database.add_user("bob", "h4") is False                       # nom déjà pris
    assert database.list_users() == ["alice", "bob"]
    assert database.get_user_hash("bob") == "h3"
    assert database.set_user_password("bob", "h5") and database.get_user_hash("bob") == "h5"
    assert database.delete_user("bob") is True and database.delete_user("bob") is False
    assert database.get_user_hash("bob") is None


def test_devices_are_registered_once_and_can_be_placed_and_moved():
    first = database.upsert_device("api-1", "Volet salon")
    again = database.upsert_device("api-1", "Volet salon renommé")
    assert again["id"] == first["id"] and again["api_name"] == "Volet salon renommé"
    card = database.create_card("Rez-de-chaussée")
    placed = database.update_device_placement(first["id"], card["id"], 12.5, 7.25)
    assert (placed["card_id"], placed["x"], placed["y"]) == (card["id"], 12.5, 7.25)
    moved = database.reassociate_device(first["id"], "api-2", "Autre nom")
    assert moved["api_id"] == "api-2"
    assert [d["api_id"] for d in database.get_all_devices()] == ["api-2"]


def test_cards_and_rooms_round_trip_with_real_numbers():
    card = database.create_card("Étage", "0 0 1000 700", 12.345678901234)
    assert card["id"] and card["north_angle"] == 12.345678901234           # aucune perte
    updated = database.update_card(card["id"], "Étage 1", "0 0 800 600", 90)
    assert (updated["name"], updated["north_angle"]) == ("Étage 1", 90)
    room = database.create_room(card["id"], "Chambre", 10, 20.5, 300, 200)
    assert room["id"] and room["card_id"] == card["id"]
    assert database.update_room(room["id"], card["id"], "Bureau", 1, 2, 3, 4)["name"] == "Bureau"
    assert [r["name"] for r in database.get_rooms_by_card(card["id"])] == ["Bureau"]
    assert [c["name"] for c in database.get_all_cards()] == ["Étage 1"]


def test_deleting_a_room_or_a_card_leaves_no_dangling_reference():
    card = database.create_card("Maison")
    room = database.create_room(card["id"], "Salon", 0, 0, 10, 10)
    dev = database.upsert_device("api-9", "Volet")
    database.update_device(dev["id"], None, 180, None, room["id"], card["id"], None)
    database.update_device_placement(dev["id"], card["id"], 3.5, 4.5)
    database.delete_room(room["id"])
    assert database.get_rooms_by_card(card["id"]) == []
    row = [d for d in database.get_all_devices() if d["id"] == dev["id"]][0]
    assert row["room_id"] is None and row["card_id"] == card["id"]
    room2 = database.create_room(card["id"], "Cuisine", 0, 0, 10, 10)
    database.update_device(dev["id"], None, 180, None, room2["id"], card["id"], None)
    database.delete_card(card["id"])                                   # ni pièce ni appareil ne pointent plus vers la carte
    assert database.get_all_cards() == [] and database.get_rooms_by_card(card["id"]) == []
    row = [d for d in database.get_all_devices() if d["id"] == dev["id"]][0]
    assert (row["room_id"], row["card_id"], row["x"], row["y"]) == (None, None, None, None)


def test_schedules_and_their_executions():
    s = schedules_db.create_schedule({"name": "Matin", "mode": "fixed", "device_ids": [1, 2], "action": "open", "level": 100, "params": {"time": "07:30"}, "enabled": 1})
    assert s["id"]
    schedules_db.toggle_schedule(s["id"], False)
    listed = schedules_db.get_all_schedules()
    assert len(listed) == 1 and listed[0]["enabled"] in (0, False)
    schedules_db.log_execution(s["id"], "success")
    schedules_db.log_execution(s["id"], "error", "boîte injoignable")
    executions = schedules_db.get_executions(s["id"])
    assert {e["status"] for e in executions} == {"error", "success"}
    assert all(isinstance(e["executed_at"], str) and len(e["executed_at"]) == 19 for e in executions)
    schedules_db.delete_schedule(s["id"])
    assert schedules_db.get_all_schedules() == []
