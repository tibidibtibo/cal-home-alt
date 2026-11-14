import logging
from datetime import datetime, time as time_type, timedelta, date as date_type
from functools import lru_cache
import holidays
import pytz
from astral import LocationInfo
from astral.sun import sun, azimuth, elevation
from .config import settings

_LOGGER = logging.getLogger(__name__)


@lru_cache(maxsize=4)
def _holiday_calendar(country: str):
    try:
        return holidays.country_holidays(country)
    except NotImplementedError:
        _LOGGER.warning("HOLIDAYS_COUNTRY=%r inconnu : jours fériés ignorés", country)
        return {}


def get_day_type(d: date_type | None = None) -> dict:
    """Type de jour pour `d` (aujourd'hui si None) : holiday (férié du pays HOLIDAYS_COUNTRY), weekend (sam/dim) ou weekday."""
    d = d or datetime.now(pytz.timezone(settings.timezone)).date()
    name = _holiday_calendar((settings.holidays_country or "FR").upper()).get(d)
    if name:
        return {"day_type": "holiday", "holiday": name}
    return {"day_type": "weekend" if d.weekday() >= 5 else "weekday", "holiday": None}


def _parse_hhmm(value: str) -> time_type:
    h, m = map(int, value.split(":"))
    return time_type(h, m)


def get_absence_events(params: dict, for_date: date_type | None = None) -> list[dict]:
    """Événements du mode absence pour un jour : ouverture à `open_weekday` (semaine) ou `open_weekend`
    (week-end et fériés), fermeture au coucher + `close_offset_min`. Retourne [{time: datetime, action}]."""
    loc = get_location()
    tz = pytz.timezone(settings.timezone)
    d = for_date or datetime.now(tz).date()
    key = "open_weekday" if get_day_type(d)["day_type"] == "weekday" else "open_weekend"
    open_at = tz.localize(datetime.combine(d, _parse_hhmm(params.get(key) or ("08:00" if key == "open_weekday" else "09:30"))))
    sunset = sun(loc.observer, date=d, tzinfo=loc.timezone)["sunset"]
    close_at = sunset + timedelta(minutes=int(params.get("close_offset_min", 10)))
    return [{"time": open_at, "action": "open"}, {"time": close_at, "action": "close"}]


def get_location():
    return LocationInfo(
        "Home", "France", settings.timezone,
        settings.latitude, settings.longitude
    )

def get_sun_event_time(event: str, offset_min: int = 0, for_date: date_type | None = None) -> datetime:
    """Return sunrise/sunset + offset_min for `for_date` (today if None)."""
    loc = get_location()
    d = for_date or datetime.now(pytz.timezone(settings.timezone)).date()
    s = sun(loc.observer, date=d, tzinfo=loc.timezone)

    if event == 'sunrise':
        base_time = s['sunrise']
    elif event == 'sunset':
        base_time = s['sunset']
    else:
        raise ValueError(f"Unknown sun event: {event}")

    return base_time + timedelta(minutes=offset_min)

def is_sun_in_range(az_min: float, az_max: float, alt_min: float) -> bool:
    """Return True if current sun azimuth/altitude is within range."""
    loc = get_location()
    now = datetime.now(pytz.timezone(settings.timezone))

    current_az = azimuth(loc.observer, now)
    current_alt = elevation(loc.observer, now)

    if az_min <= current_az <= az_max and current_alt >= alt_min:
        return True
    return False


def get_sun_times(for_date: date_type | None = None) -> dict:
    """Return sunrise/sunset as HH:MM strings for the given date (today if None)."""
    loc = get_location()
    tz = pytz.timezone(settings.timezone)
    d = for_date or datetime.now(tz).date()
    s = sun(loc.observer, date=d, tzinfo=loc.timezone)
    return {
        "sunrise": s["sunrise"].astimezone(tz).strftime("%H:%M"),
        "sunset": s["sunset"].astimezone(tz).strftime("%H:%M"),
    }


def compute_daily_transitions(
    orientation: float,
    half_angle: float,
    altitude_min: float,
    azimuth_offset: float = 0,
    for_date: date_type | None = None,
) -> list[dict]:
    """Return [{time: HH:MM, action: close|open}] state transitions for the given date."""
    loc = get_location()
    tz = pytz.timezone(settings.timezone)
    d = for_date or datetime.now(tz).date()

    effective_orientation = (orientation + azimuth_offset) % 360
    transitions: list[dict] = []
    prev_active: bool | None = None

    current = datetime(d.year, d.month, d.day, 0, 0, tzinfo=tz)
    end = current + timedelta(days=1)

    while current < end:
        current_az = azimuth(loc.observer, current)
        current_alt = elevation(loc.observer, current)

        if current_alt < altitude_min:
            active = False
        else:
            diff = abs(((current_az - effective_orientation) + 180) % 360 - 180)
            active = diff <= half_angle

        if prev_active is not None and active != prev_active:
            transitions.append({
                "time": current.strftime("%H:%M"),
                "action": "close" if active else "open",
            })

        prev_active = active
        current += timedelta(minutes=5)

    return transitions


def is_bso_active(orientation: float, half_angle: float, altitude_min: float, azimuth_offset: float = 0) -> bool:
    """Return True if sun is currently hitting a shutter facing `orientation` degrees.

    orientation: compass direction the window faces (0=N, 90=E, 180=S, 270=W)
    half_angle: degrees on each side of orientation that count as exposure (e.g. 60 → 120° arc)
    altitude_min: minimum sun elevation in degrees to activate BSO
    azimuth_offset: temporary correction applied to orientation (positive = shift exposure window clockwise)
    """
    loc = get_location()
    now = datetime.now(pytz.timezone(settings.timezone))

    current_az = azimuth(loc.observer, now)
    current_alt = elevation(loc.observer, now)

    if current_alt < altitude_min:
        return False

    effective_orientation = (orientation + azimuth_offset) % 360
    diff = abs(((current_az - effective_orientation) + 180) % 360 - 180)
    return diff <= half_angle
