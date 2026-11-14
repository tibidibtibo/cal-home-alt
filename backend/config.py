from . import database


class _Settings:
    """DB-backed settings — reads and writes live from/to database."""

    def __getattr__(self, name: str):
        key = name.upper()
        val = database.get_setting(key)
        if key == "POLL_INTERVAL":
            return int(val) if val else 300
        if key == "LATITUDE":
            return float(val) if val else 48.8566
        if key == "LONGITUDE":
            return float(val) if val else 2.3522
        if key == "SMTP_PORT":
            return int(val) if val else 587
        if key == "TIMEZONE":
            return val or "Europe/Paris"
        nullable = {
            "smtp_host", "smtp_user", "smtp_password", "smtp_from",
            "notify_email_to",
        }
        if name in nullable:
            return val or None
        return val

    def __setattr__(self, name: str, value):
        database.set_setting(name.upper(), "" if value is None else str(value))


settings = _Settings()
