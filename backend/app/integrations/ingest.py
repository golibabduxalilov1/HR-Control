"""Common entry point for inbound pass events (HikCentral, webhook, Telegram)."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from dateutil import parser as dtparser
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.project_settings import merged_settings
from app.models import AttendanceEvent, Device, Employee, EventDirection, EventSource, Project
from app.services.payroll import PayrollService
from app.services.timesheet import TimesheetService, business_date_for


async def ingest_event(
    db: AsyncSession, project: Project, *, employee_number: str | None = None, employee: Employee | None = None,
    hik_person_id: str | None = None, event_time, direction: str = "in", external_id: str | None = None,
    device_label: str = "", device: Device | None = None, source: str = "terminal", photo_path: str | None = None, notify: bool = True,
) -> dict:
    tz = ZoneInfo(project.timezone or "Asia/Tashkent")
    if isinstance(event_time, str):
        event_time = dtparser.parse(event_time)
    if event_time.tzinfo is None:
        event_time = event_time.replace(tzinfo=tz)

    if employee is None:
        q = select(Employee).where(Employee.project_id == project.id, Employee.deleted_at.is_(None))
        if hik_person_id:
            q = q.where(Employee.hik_person_id == str(hik_person_id))
        elif employee_number:
            q = q.where(Employee.employee_number == str(employee_number))
        else:
            return {"ok": False, "reason": "no identifier"}
        employee = (await db.execute(q)).scalars().first()
    if employee is None:
        return {"ok": False, "reason": "employee not found", "employee_number": employee_number, "hik_person_id": hik_person_id}

    if external_id:
        dup = (await db.execute(select(AttendanceEvent.id).where(AttendanceEvent.project_id == project.id, AttendanceEvent.external_id == external_id))).first()
        if dup:
            return {"ok": True, "duplicate": True, "employee_id": employee.id}

    ev = AttendanceEvent(project_id=project.id, employee_id=employee.id, device_id=device.id if device else None, event_time=event_time,
                         direction=EventDirection.check_out if direction in ("out", "exit", "2") else EventDirection.check_in,
                         source=EventSource(source), external_id=external_id, device_label=device_label or (device.name if device else ""), photo_path=photo_path)
    db.add(ev)
    if device:
        device.last_seen_at = datetime.now(timezone.utc)
        device.is_online = True
    await db.flush()

    ts = TimesheetService(db, project)
    day = business_date_for(event_time.astimezone(tz), int(ts.settings.get("day_close_hour", 0) or 0))
    res = await ts.recompute_employee(employee, day, day)
    row = res[day][0]
    settings = merged_settings(project.settings)
    if settings.get("finance_enabled", True):
        await PayrollService(db, project).sync_auto_fines(employee, {day: row}, datetime.now(tz).date())
    if settings.get("auto_accrue_on_checkout") and ev.direction == EventDirection.check_out and employee.salary_rates:
        await PayrollService(db, project).accrue_salary(employee, day.year, day.month, "system")

    if notify:
        try:
            from app.bots.notify import notify_pass
            await notify_pass(db, project, employee, ev, row)
        except Exception:  # noqa: BLE001
            pass
    return {"ok": True, "event_id": ev.id, "employee_id": employee.id, "day_status": row.status.value, "late_minutes": row.late_minutes}
