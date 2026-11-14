import time
import logging
import smtplib
import asyncio
from email.mime.text import MIMEText
from .config import settings

_LOGGER = logging.getLogger(__name__)
_last_sent: dict[str, float] = {}
_COOLDOWN_SEC = 30 * 60


def notify(key: str, message: str) -> None:
    now = time.time()
    if now - _last_sent.get(key, 0) < _COOLDOWN_SEC:
        return
    _last_sent[key] = now

    _LOGGER.info(f"Notification triggered: {message}")

    if settings.notify_channel == "email" and settings.smtp_host and settings.notify_email_to:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_send_email(message))
        except RuntimeError:
            asyncio.run(_send_email(message))


async def _send_email(message: str) -> bool:
    sender = settings.smtp_from or settings.smtp_user
    msg = MIMEText(f"🏠 Calyps'HOME: {message}", "plain", "utf-8")
    msg["Subject"] = "Calyps'HOME notification"
    msg["From"] = sender
    msg["To"] = settings.notify_email_to
    host, port, user, password, to = settings.smtp_host, settings.smtp_port or 587, settings.smtp_user, settings.smtp_password, settings.notify_email_to

    def _send() -> None:
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.starttls()
            if user and password:
                smtp.login(user, password)
            smtp.sendmail(sender, [to], msg.as_string())

    try:
        await asyncio.to_thread(_send)   # SMTP est bloquant : jamais sur la boucle asyncio
        return True
    except Exception as e:
        _LOGGER.error(f"Failed to send email notification: {e}")
        return False

