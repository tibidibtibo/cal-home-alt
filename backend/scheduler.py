import asyncio
import logging
import json
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.date import DateTrigger
from datetime import datetime, timedelta
import pytz
from typing import Dict, Optional, List

from . import database
from . import schedules_db
from . import sun
from .config import settings

_LOGGER = logging.getLogger(__name__)
scheduler = AsyncIOScheduler(timezone=settings.timezone)

# Tracks last known BSO state per (schedule_id, shutter_idx)
_bso_states: dict[tuple[int, int], bool | None] = {}

def parse_fixed_days(days) -> Optional[List[int]]:
    """Jours d'une règle « fixe » -> numéros Python (0=lundi..6=dimanche), None = tous les jours.

    L'interface stocke 1=lundi..7=dimanche (« 1,2,3 ») ; « * » ou vide = tous les jours."""
    if days in (None, "", "*"):
        return None
    items = days if isinstance(days, (list, tuple)) else str(days).split(",")
    out = sorted({int(n) - 1 for n in items if str(n).strip().isdigit() and 1 <= int(n) <= 7})
    return out


def load_all_schedules() -> None:
    """Load all enabled schedules and add them to the scheduler."""
    scheduler.remove_all_jobs()

    # Job to recalc daily presence events
    scheduler.add_job(load_all_schedules, CronTrigger(hour=0, minute=5), id="daily_recalc")

    # US-14: Check for open shutters at 23:00
    scheduler.add_job(check_open_at_23h, CronTrigger(hour=23, minute=0), id="check_23h")

    schedules = schedules_db.get_all_schedules()
    for s in schedules:
        if not s['enabled']:
            continue

        try:
            if s['mode'] == 'fixed':
                time_fixed = s['params'].get('time') # "HH:MM"
                if time_fixed:
                    h, m = map(int, time_fixed.split(':'))
                    weekdays = parse_fixed_days(s['params'].get('days'))
                    if weekdays == []:
                        continue  # aucun jour valide : la règle ne se déclenche jamais
                    scheduler.add_job(
                        execute_schedule,
                        CronTrigger(hour=h, minute=m, day_of_week="*" if weekdays is None else ",".join(map(str, weekdays))),
                        args=[s['id']],
                        id=f"sched_{s['id']}"
                    )

            elif s['mode'] == 'presence':
                # Presence mode depends on sun events
                event = s['params'].get('sun_event') # 'sunrise' or 'sunset'
                offset = s['params'].get('offset_min', 0)
                if event:
                    run_time = sun.get_sun_event_time(event, offset)
                    if run_time > datetime.now(pytz.timezone(settings.timezone)):
                        scheduler.add_job(
                            execute_schedule,
                            DateTrigger(run_date=run_time),
                            args=[s['id']],
                            id=f"sched_{s['id']}",
                            misfire_grace_time=300,
                        )

            elif s['mode'] == 'absence':
                # Ouverture (heure selon semaine/week-end/férié) + fermeture au coucher : recalculé chaque jour à 00:05
                now = datetime.now(pytz.timezone(settings.timezone))
                for ev in sun.get_absence_events(s['params']):
                    if ev['time'] > now:
                        scheduler.add_job(
                            execute_schedule,
                            DateTrigger(run_date=ev['time']),
                            args=[s['id'], ev['action']],
                            id=f"sched_{s['id']}_{ev['action']}",
                            misfire_grace_time=300,
                        )

            elif s['mode'] == 'solar':
                # Check every 5 minutes
                scheduler.add_job(
                    check_solar_schedule,
                    IntervalTrigger(minutes=5),
                    args=[s['id']],
                    id=f"sched_{s['id']}"
                )
        except Exception as e:
            _LOGGER.error(f"Error loading schedule {s['id']}: {e}")

async def execute_schedule(schedule_id: int, action: Optional[str] = None) -> None:
    """`action` : remplace l'action de la règle (mode absence : une règle = ouvrir le matin ET fermer le soir)."""
    from .state import state_manager
    _LOGGER.info(f"Executing schedule {schedule_id}")
    schedules = [s for s in schedules_db.get_all_schedules() if s['id'] == schedule_id]
    if not schedules:
        return
    s = schedules[0]

    action = action or s['action']
    success = True
    error_msg = None

    for shutter_idx in s['shutter_ids']:
        real_id = state_manager.get_real_id(str(shutter_idx))
        if not real_id:
            continue

        ok = False
        if action == 'open':
            ok = await asyncio.to_thread(state_manager.api.open_shutter, real_id)
        elif action == 'close':
            ok = await asyncio.to_thread(state_manager.api.close_shutter, real_id)
        elif action == 'level':
            ok = await asyncio.to_thread(state_manager.api.set_level, real_id, s['level'])

        if not ok:
            success = False
            error_msg = f"Failed to command shutter {shutter_idx}"

    schedules_db.log_execution(schedule_id, "success" if success else "error", error_msg)
    await state_manager.update_state()

async def check_solar_schedule(schedule_id: int) -> None:
    from .state import state_manager
    schedules = [s for s in schedules_db.get_all_schedules() if s['id'] == schedule_id]
    if not schedules:
        return
    s = schedules[0]
    params = s['params']

    half_angle = params.get('half_angle', 60)
    alt_min = params.get('altitude_min', 20)
    az_offset = params.get('azimuth_offset', 0)
    alt_offset = params.get('altitude_offset', 0)
    effective_alt_min = alt_min + alt_offset

    any_ok = False
    for shutter_idx in s['shutter_ids']:
        orientation = state_manager.get_shutter_orientation(str(shutter_idx))
        if orientation is None:
            # Fallback to schedule-level orientation for backward compat
            orientation = params.get('orientation', 180)

        is_active = sun.is_bso_active(orientation, half_angle, effective_alt_min, az_offset)
        key = (schedule_id, shutter_idx)
        was_active = _bso_states.get(key)

        if was_active != is_active:
            _bso_states[key] = is_active
            if await _execute_bso_for_shutter(s, shutter_idx, close=is_active):
                any_ok = True

    if any_ok:
        await state_manager.update_state()


async def _execute_bso_for_shutter(s: dict, shutter_idx: int, close: bool) -> bool:
    from .state import state_manager
    params = s['params']
    target_level = params.get('close_level', 0) if close else params.get('open_level', 100)
    label = "fermeture BSO" if close else "ouverture BSO"
    _LOGGER.info(f"BSO schedule {s['id']} volet {shutter_idx}: {label} → niveau {target_level}%")

    real_id = state_manager.get_real_id(str(shutter_idx))
    if not real_id:
        return False
    ok = await asyncio.to_thread(state_manager.api.set_level, real_id, target_level)
    schedules_db.log_execution(
        s['id'],
        "success" if ok else "error",
        None if ok else f"Failed to command shutter {shutter_idx}",
    )
    return ok


async def check_open_at_23h() -> None:
    from .state import state_manager
    from . import notifications

    if database.get_setting("NOTIFY_OPEN_AT_23H") == "0":
        return

    open_shutters = [s.custom_name or s.name for s in state_manager.devices if s.type == "shutter" and s.level is not None and s.level < 95]
    if open_shutters:
        msg = f"Alerte : {len(open_shutters)} volets sont encore ouverts : {', '.join(open_shutters)}"
        notifications.notify("open_at_23h", msg)


def get_next_actions() -> Dict[int, dict]:
    """Calculate the next scheduled action for each device."""
    from .state import state_manager
    next_actions = {}
    now = datetime.now(pytz.timezone(settings.timezone))
    schedules = schedules_db.get_all_schedules()
    enabled_schedules = {s["id"]: s for s in schedules if s["enabled"]}

    # 1. Inspect APScheduler jobs for fixed and presence modes
    for job in scheduler.get_jobs():
        if not job.id.startswith("sched_"):
            continue
        try:
            sched_id = int(job.id.replace("sched_", ""))
        except ValueError:
            continue

        if sched_id not in enabled_schedules:
            continue

        s = enabled_schedules[sched_id]
        if s["mode"] not in ("fixed", "presence"):
            continue

        next_run = job.next_run_time
        if not next_run:
            continue

        action_desc = s["action"]
        if action_desc == "level":
            action_desc = f"{s['level']}%"

        for dev_idx in s["shutter_ids"]:
            try:
                dev_idx = int(dev_idx)
            except (ValueError, TypeError):
                continue

            if dev_idx not in next_actions or next_run < next_actions[dev_idx]["time"]:
                next_actions[dev_idx] = {
                    "time": next_run,
                    "action": action_desc,
                    "schedule_name": s["name"],
                }

    # 1b. Mode absence : prochain événement (aujourd'hui, sinon demain)
    for s in enabled_schedules.values():
        if s["mode"] != "absence":
            continue
        try:
            events = [
                ev
                for offset in (0, 1)
                for ev in sun.get_absence_events(s["params"], now.date() + timedelta(days=offset))
                if ev["time"] > now
            ]
        except Exception as e:
            _LOGGER.error(f"Error computing absence events for schedule {s['id']}: {e}")
            continue
        if not events:
            continue
        nxt = min(events, key=lambda ev: ev["time"])
        for dev_idx in s["shutter_ids"]:
            try:
                dev_idx = int(dev_idx)
            except (ValueError, TypeError):
                continue
            if dev_idx not in next_actions or nxt["time"] < next_actions[dev_idx]["time"]:
                next_actions[dev_idx] = {
                    "time": nxt["time"],
                    "action": nxt["action"],
                    "schedule_name": s["name"],
                }

    # 2. Predict next BSO transitions for solar mode
    for s in enabled_schedules.values():
        if s["mode"] != "solar":
            continue

        params = s["params"]
        half_angle = params.get("half_angle", 60)
        alt_min = params.get("altitude_min", 20)
        az_offset = params.get("azimuth_offset", 0)
        alt_offset = params.get("altitude_offset", 0)
        effective_alt_min = alt_min + alt_offset
        open_level = params.get("open_level", 100)
        close_level = params.get("close_level", 0)

        for dev_idx in s["shutter_ids"]:
            try:
                dev_idx = int(dev_idx)
            except (ValueError, TypeError):
                continue

            orientation = state_manager.get_shutter_orientation(str(dev_idx))
            if orientation is None:
                orientation = params.get("orientation", 180)

            transitions = sun.compute_daily_transitions(
                orientation, half_angle, effective_alt_min, az_offset
            )

            for t in transitions:
                h, m = map(int, t["time"].split(':'))
                t_time = now.replace(hour=h, minute=m, second=0, microsecond=0)
                if t_time > now:
                    if dev_idx not in next_actions or t_time < next_actions[dev_idx]["time"]:
                        target_level = close_level if t["action"] == "close" else open_level
                        next_actions[dev_idx] = {
                            "time": t_time,
                            "action": f"{target_level}%",
                            "schedule_name": s["name"],
                        }
                    break

    # Convert times to ISO strings for JSON serialization
    return {
        idx: {**act, "time": act["time"].isoformat()}
        for idx, act in next_actions.items()
    }



def _device_name(idx) -> str:
    from .state import state_manager
    with state_manager._lock:
        try:
            dev = state_manager.devices[int(idx)]
            return dev.custom_name or dev.name
        except (IndexError, ValueError, TypeError):
            return f"Volet {idx}"


def get_day_plan(for_date=None) -> List[dict]:
    """Planning d'un jour : tous les événements des règles ACTIVES, triés par heure.

    Calculé à la volée depuis la base (pas depuis les jobs APScheduler, qui n'existent plus une fois exécutés)
    pour refléter exactement ce qui s'exécute ce jour-là. Chaque événement :
    {time (ISO), action (open|close|level), level, schedule_id, schedule_name, mode, device_ids, device_names}."""
    from .state import state_manager
    tz = pytz.timezone(settings.timezone)
    d = for_date or datetime.now(tz).date()
    events: List[dict] = []

    def add(s: dict, when: datetime, action: str, device_ids: list, level: Optional[int] = None) -> None:
        events.append({
            "time": when.astimezone(tz).isoformat(),
            "action": action,
            "level": level,
            "schedule_id": s["id"],
            "schedule_name": s["name"],
            "mode": s["mode"],
            "device_ids": [str(i) for i in device_ids],
            "device_names": [_device_name(i) for i in device_ids],
        })

    for s in schedules_db.get_all_schedules():
        if not s["enabled"]:
            continue
        params = s["params"]
        try:
            if s["mode"] == "fixed":
                hhmm = params.get("time")
                weekdays = parse_fixed_days(params.get("days"))
                if hhmm and (weekdays is None or d.weekday() in weekdays):
                    h, m = map(int, hhmm.split(":"))
                    add(s, tz.localize(datetime(d.year, d.month, d.day, h, m)), s["action"], s["shutter_ids"],
                        s["level"] if s["action"] == "level" else None)

            elif s["mode"] == "presence":
                event = params.get("sun_event")
                if event:
                    when = sun.get_sun_event_time(event, params.get("offset_min", 0), d)
                    add(s, when, s["action"], s["shutter_ids"], s["level"] if s["action"] == "level" else None)

            elif s["mode"] == "absence":
                for ev in sun.get_absence_events(params, d):
                    add(s, ev["time"], ev["action"], s["shutter_ids"])

            elif s["mode"] == "solar":
                half_angle = params.get("half_angle", 60)
                alt_min = params.get("altitude_min", 20) + params.get("altitude_offset", 0)
                az_offset = params.get("azimuth_offset", 0)
                grouped: Dict[tuple, list] = {}
                for idx in s["shutter_ids"]:
                    orientation = state_manager.get_shutter_orientation(str(idx))
                    if orientation is None:
                        orientation = params.get("orientation", 180)
                    for t in sun.compute_daily_transitions(orientation, half_angle, alt_min, az_offset, d):
                        grouped.setdefault((t["time"], t["action"]), []).append(idx)
                for (hhmm, action), idxs in grouped.items():
                    h, m = map(int, hhmm.split(":"))
                    level = params.get("close_level", 0) if action == "close" else params.get("open_level", 100)
                    add(s, tz.localize(datetime(d.year, d.month, d.day, h, m)), action, idxs, level)
        except Exception as e:
            _LOGGER.error(f"Error computing day plan for schedule {s['id']}: {e}")

    events.sort(key=lambda ev: (ev["time"], ev["schedule_id"]))
    return events
