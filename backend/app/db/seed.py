"""Bootstrap data: platform admin + optional demo tenant (`python -m app.db.seed demo`)."""

from __future__ import annotations

import asyncio
import pathlib
import random
import sys
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import hash_password
from app.services.files import save_bytes
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models import (
    AttendanceEvent,
    CabinetUser,
    Department,
    Employee,
    EventDirection,
    EventSource,
    Holiday,
    License,
    PlatformUser,
    Position,
    Project,
    RateType,
    SalaryRate,
    Schedule,
    ScheduleMode,
    UserRole,
)


async def ensure_columns() -> None:
    """Add columns that were introduced after the table was created (create_all never ALTERs)."""
    from sqlalchemy import inspect, text

    async with engine.begin() as conn:
        def missing(sync_conn):
            insp = inspect(sync_conn)
            out = []
            for table in Base.metadata.sorted_tables:
                if not insp.has_table(table.name):
                    continue
                existing = {c["name"] for c in insp.get_columns(table.name)}
                for col in table.columns:
                    if col.name not in existing:
                        out.append((table.name, col))
            return out

        for table_name, col in await conn.run_sync(missing):
            col_type = col.type.compile(dialect=conn.dialect)
            await conn.execute(text(f'ALTER TABLE {table_name} ADD COLUMN "{col.name}" {col_type}'))


async def ensure_platform_admin() -> None:
    cfg = get_settings()
    async with SessionLocal() as db:
        exists = (await db.execute(select(PlatformUser).limit(1))).scalars().first()
        if not exists:
            db.add(PlatformUser(username=cfg.platform_admin_username, password_hash=hash_password(cfg.platform_admin_password), display_name="Platform admin"))
            await db.commit()


async def seed_demo(slug: str = "demo", password: str = "admin") -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        if (await db.execute(select(Project).where(Project.slug == slug))).scalar_one_or_none():
            print(f"project '{slug}' already exists")
            return
        tz = ZoneInfo("Asia/Tashkent")
        p = Project(slug=slug, name="Demo Company", timezone="Asia/Tashkent", settings={
            "auto_fines_enabled": True, "auto_fine_late_enabled": True, "auto_fine_late_amount": 20000, "tasks_enabled": True,
        })
        db.add(p)
        await db.flush()
        db.add(License(project_id=p.id, plan_name="Тест", valid_until=datetime.now(timezone.utc) + timedelta(days=365), max_employees=50, max_devices=2, max_branches=2))
        db.add(CabinetUser(project_id=p.id, username="admin", password_hash=hash_password(password), display_name="Admin", role=UserRole.admin))
        db.add(CabinetUser(project_id=p.id, username="oper", password_hash=hash_password(password), display_name="Operator", role=UserRole.operator))

        deps = {n: Department(project_id=p.id, name=n) for n in ["Тех", "Сантех", "Продажа", "Бухгалтерия"]}
        db.add_all(deps.values())
        await db.flush()
        positions = {"Технар": Position(project_id=p.id, name="Технар", department_id=deps["Тех"].id),
                     "Менеджер": Position(project_id=p.id, name="Менеджер", department_id=deps["Продажа"].id),
                     "Бухгалтер": Position(project_id=p.id, name="Бухгалтер", department_id=deps["Бухгалтерия"].id)}
        db.add_all(positions.values())

        fixed = Schedule(project_id=p.id, name="08:00-17:00", code="F1", type="fixed", start_time=time(8), end_time=time(17), lunch_enabled=True,
                         lunch_start=time(12), lunch_end=time(13), late_grace_min=10, early_grace_min=10, work_days=[True] * 6 + [False])
        office = Schedule(project_id=p.id, name="09:00-18:00", code="F2", type="fixed", start_time=time(9), end_time=time(18), lunch_enabled=True,
                          lunch_start=time(13), lunch_end=time(14), late_grace_min=15, early_grace_min=10, work_days=[True] * 5 + [False, False])
        flexible = Schedule(project_id=p.id, name="Гибкий", code="FLEX", type="flexible", work_days=[True] * 7)
        db.add_all([fixed, office, flexible])
        await db.flush()

        year = date.today().year
        for (m, d), name in [((1, 1), "Новый год"), ((3, 8), "Международный женский день"), ((3, 21), "Навруз"), ((5, 9), "День памяти и почестей"),
                             ((9, 1), "День независимости"), ((10, 1), "День учителя и наставника"), ((12, 8), "День Конституции")]:
            db.add(Holiday(project_id=p.id, date=date(year, m, d), name=name))

        people = [
            ("Шерзод Давронов", "Тех", "Технар", fixed, 5_000_000, RateType.monthly, "+998901112233"),
            ("Хилола Каримова", "Бухгалтерия", "Бухгалтер", office, 8_000_000, RateType.monthly, "+998904765151"),
            ("Джамшед Ташбулатов", "Продажа", "Менеджер", fixed, 15_000, RateType.hourly, "+998979269111"),
            ("Азамхон Умаров", "Продажа", "Менеджер", office, 6_000_000, RateType.monthly, "+998978910150"),
            ("Амирджон Акбаралиев", "Сантех", None, None, 4_500_000, RateType.monthly, "+998915450801"),
            ("Убайдуллохон Негматуллаев", None, None, None, None, None, "+998906014001"),
            ("Артём Бабаян", None, None, office, 7_000_000, RateType.monthly, "+998886116777"),
            ("Жавохир Бахтиёров", "Тех", "Технар", fixed, 4_000_000, RateType.monthly, "+998950809929"),
        ]
        employees = []
        avatars_dir = pathlib.Path(__file__).resolve().parents[2] / "assets" / "demo-avatars"
        for i, (name, dep, pos, sched, rate, rate_type, phone) in enumerate(people, start=1):
            e = Employee(project_id=p.id, full_name=name, phone=phone, employee_number=str(1000 + i), department_id=deps[dep].id if dep else None,
                         position_id=positions[pos].id if pos else None, schedule_id=sched.id if sched else None,
                         schedule_mode=ScheduleMode.fixed if sched and sched.type != "flexible" else ScheduleMode.flexible,
                         hire_date=date.today().replace(day=1) - timedelta(days=90), birth_date=date(1990 + i, (i * 3) % 12 + 1, 10 + i))
            if rate:
                e.salary_rates.append(SalaryRate(rate_type=rate_type, amount=rate, effective_from=date.today().replace(day=1) - timedelta(days=90)))
            db.add(e)
            employees.append(e)
        await db.flush()
        for i, e in enumerate(employees, start=1):
            photo = avatars_dir / f"{i}.jpg"
            if photo.exists():
                e.avatar_path = save_bytes(photo.read_bytes(), slug, "avatars", f"{e.id}.jpg")

        # synthetic passes for the current month
        rnd = random.Random(42)
        today = date.today()
        day = today.replace(day=1)
        while day <= today:
            for e in employees:
                if e.schedule_id is None and rnd.random() < 0.5:
                    continue
                if day.weekday() == 6 or rnd.random() < 0.12:
                    continue
                start_h = 8 if e.schedule_id == fixed.id else 9
                if e.schedule_id == office.id and day.weekday() == 5:
                    continue  # office schedule is Mon–Fri
                # most people are on time; one employee is chronically late
                late = rnd.choice([0, 0, 0, 0, 0, 0, 3, 8, 25]) if e.id != employees[0].id else rnd.choice([0, 15, 40, 90, 150])
                cin = datetime.combine(day, time(start_h, 0), tz) + timedelta(minutes=late - rnd.randint(0, 12))
                db.add(AttendanceEvent(project_id=p.id, employee_id=e.id, event_time=cin, direction=EventDirection.check_in, source=EventSource.terminal,
                                       device_label="Терминал · Вход", external_id=f"seed:{e.id}:{day}:in"))
                if day < today or rnd.random() < 0.3:
                    cout = datetime.combine(day, time(start_h + 9, 0), tz) + timedelta(minutes=rnd.choice([0, 0, 2, 5, 15, 40, -12, -30]))
                    db.add(AttendanceEvent(project_id=p.id, employee_id=e.id, event_time=cout, direction=EventDirection.check_out, source=EventSource.terminal,
                                           device_label="Терминал · Выход", external_id=f"seed:{e.id}:{day}:out"))
            day += timedelta(days=1)
        await db.commit()
        print(f"demo project created: /{slug}  login admin / {password}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "demo":
        asyncio.run(seed_demo(*(sys.argv[2:4])))
    else:
        asyncio.run(ensure_platform_admin())
