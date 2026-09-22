"""Background jobs: HikCentral polling, absent alerts, nightly recompute."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.core.config import get_settings
from app.core.project_settings import merged_settings
from app.db.session import SessionLocal
from app.models import DayStatus, Employee, EmployeeStatus, Project
from app.services.payroll import PayrollService
from app.services.timesheet import TimesheetService

log = logging.getLogger("scheduler")
scheduler = AsyncIOScheduler()


async def poll_hikcentral() -> None:
    from app.integrations.hikcentral import sync_project_events

    async with SessionLocal() as db:
        projects = (await db.execute(select(Project).where(Project.is_active.is_(True)))).scalars().all()
        for p in projects:
            if not merged_settings(p.settings).get("hik_enabled"):
                continue
            try:
                res = await sync_project_events(db, p)
                await db.commit()
                if res.get("ingested"):
                    log.info("hik %s: %s events", p.slug, res["ingested"])
            except Exception as exc:  # noqa: BLE001
                await db.rollback()
                log.warning("hik %s failed: %s", p.slug, exc)


async def absent_alerts() -> None:
    """Every 15 min: for projects with late/absent bot, send the absent list N hours after shift start (once per day)."""
    from app.bots.notify import notify_absent_list

    async with SessionLocal() as db:
        projects = (await db.execute(select(Project).where(Project.is_active.is_(True)))).scalars().all()
        for p in projects:
            s = merged_settings(p.settings)
            if not s.get("late_absent_enabled"):
                continue
            tz = ZoneInfo(p.timezone)
            now = datetime.now(tz)
            today = now.date()
            if (p.settings or {}).get("late_absent_last_sent") == today.isoformat():
                continue
            hours = int(s.get("late_absent_after_hours", 2) or 2)
            emps = (await db.execute(select(Employee).where(Employee.project_id == p.id, Employee.deleted_at.is_(None), Employee.status == EmployeeStatus.active))).scalars().unique().all()
            ts = TimesheetService(db, p)
            res = await ts.recompute(emps, today, today, persist=False)
            absent = []
            due = False
            for e in emps:
                row, result = res[(e.id, today)]
                plan = result.plan
                if not plan or not plan.is_working or not plan.start:
                    continue
                threshold = datetime.combine(today, plan.start, tz) + timedelta(hours=hours)
                if now >= threshold:
                    due = True
                    if row.status == DayStatus.absent:
                        absent.append(e)
            if due:
                await notify_absent_list(db, p, absent, today)
                settings = dict(p.settings or {})
                settings["late_absent_last_sent"] = today.isoformat()
                p.settings = settings
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(p, "settings")
                await db.commit()


async def nightly_recompute() -> None:
    """Recompute yesterday + today for everyone (closes days, applies absent fines)."""
    async with SessionLocal() as db:
        projects = (await db.execute(select(Project).where(Project.is_active.is_(True)))).scalars().all()
        for p in projects:
            try:
                tz = ZoneInfo(p.timezone)
                today = datetime.now(tz).date()
                emps = (await db.execute(select(Employee).where(Employee.project_id == p.id, Employee.deleted_at.is_(None), Employee.status != EmployeeStatus.dismissed))).scalars().unique().all()
                ts = TimesheetService(db, p)
                res = await ts.recompute(emps, today - timedelta(days=2), today)
                if merged_settings(p.settings).get("finance_enabled", True):
                    pay = PayrollService(db, p)
                    for e in emps:
                        rows = {d: res[(e.id, d)][0] for d in (today - timedelta(days=2), today - timedelta(days=1), today)}
                        await pay.sync_auto_fines(e, rows, today)
                await db.commit()
            except Exception as exc:  # noqa: BLE001
                await db.rollback()
                log.warning("nightly %s failed: %s", p.slug, exc)


def start_scheduler() -> None:
    cfg = get_settings()
    if not cfg.scheduler_enabled or scheduler.running:
        return
    scheduler.add_job(poll_hikcentral, "interval", seconds=cfg.hik_poll_seconds, id="hik", max_instances=1, coalesce=True)
    scheduler.add_job(absent_alerts, "interval", minutes=15, id="absent", max_instances=1, coalesce=True)
    scheduler.add_job(nightly_recompute, "cron", hour="*/3", minute=7, id="nightly", max_instances=1, coalesce=True)
    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
