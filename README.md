# Face ID Workplace — Attendance & Workforce Management

A multi-tenant attendance system built on face-recognition terminals (HikCentral), with automatic timesheet
calculation, payroll (bonuses/fines), and Telegram bots for employees and managers. A from-scratch redesign
inspired by sputnikface.uz.

## Stack

| Layer | Technologies |
|------|-----------|
| Backend | Python 3.13 · FastAPI · SQLAlchemy 2 (async) · PostgreSQL (prod) / SQLite (dev) · APScheduler · aiogram 3 |
| Frontend | React 19 · Vite · TypeScript · Tailwind 4 · TanStack Query · react-router 7 · recharts · i18next (ru/uz) |
| Integrations | HikCentral Professional OpenAPI (Artemis) · Telegram Bot API · read-only Integration API + inbound webhook |

## Quick Start (dev)

```bash
# backend
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt
cp .env.example .env                       # SQLite by default
.venv/Scripts/python -m app.db.seed demo   # demo company: /demo, admin / admin
.venv/Scripts/python -m uvicorn app.main:app --port 8000 --reload

# frontend
cd frontend && npm install && npm run dev  # http://localhost:5173/demo
```

Or via the PowerShell helper: `.\dev.ps1 seed`, `.\dev.ps1 backend`, `.\dev.ps1 frontend`, `.\dev.ps1 test`.

- Company workspace: `http://localhost:5173/<slug>` (demo: `/demo`, login `admin` / `admin`, operator `oper` / `admin`)
- Platform panel (create companies, manage licenses): `http://localhost:5173/workplace` (login `platform` / `platform`, see `.env`)
- Swagger: `http://localhost:8000/api/docs`

## Production

```bash
# backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# frontend
cd frontend && npm install && npm run build   # serve the contents of dist/ with any web server
```

Make sure to set `SECRET_KEY`, `PLATFORM_ADMIN_PASSWORD`, and `DATABASE_URL` (PostgreSQL). SQLite is only meant
for development — in that mode database queries are serialized.

## Project Structure

```
backend/app
  core/        config, security (JWT/bcrypt), deps (auth & tenant resolution), project_settings (per-tenant defaults)
  models/      SQLAlchemy models (every tenant table carries a project_id)
  schemas/     Pydantic schemas
  api/routers/ auth, structure, employees, schedules, attendance, payroll, dashboard, settings, requests_tasks,
               devices_integrations, platform (/workplace), public_api (+ /v1/integration)
  services/    timesheet (attendance engine), payroll (accruals, auto-fines), audit, files, scheduler
  integrations/ hikcentral (OpenAPI client + sync), ingest (single entry point for all attendance events)
  bots/        manager (per-tenant polling), handlers (aiogram), notify, templates ru/uz
frontend/src
  pages/       Dashboard, Today, Structure, Employees (+Drawer, +Form), Schedules, Timesheet, Payroll, Tasks,
               Notifications, Settings, Workplace, Login
  components/  ui (modals, selects, toast, KPI...), layout (AppLayout with sidebar)
```

## Core Logic

### Multi-tenancy
Every company ("project") is a fully isolated tenant, identified by a `slug` in the URL (e.g. `/demo`). All
tenant-scoped database tables carry a `project_id` column, and every query is filtered by the tenant resolved
from the authenticated user/session (`core/deps`). A separate **platform** layer (`/workplace`) sits above all
tenants and is used to create companies and manage licenses — it is not scoped to any single tenant.

### Attendance pipeline
1. **Raw events** (`attendance_events`) — every check-in/check-out signal, regardless of source (HikCentral
   terminal, Telegram bot, or manual entry by an operator), is stored as an immutable raw event. Events are never
   deleted, only hidden, so the audit trail is always reconstructable.
2. **Ingestion** — all raw events funnel through one entry point (`integrations/ingest.py`), whether pulled from
   HikCentral (polled every 45s via `integrations/hikcentral.py`) or pushed by any external source to
   `POST /api/v1/integration/events` using an API key.
3. **Timesheet engine** (`services/timesheet.py`) — turns raw events into `attendance_days`: one materialized
   record per employee per day, holding status, check-in/out times, worked hours, and lateness. This is
   recalculated automatically whenever new events arrive or existing ones are edited. A manual correction
   (`is_manual = true`) always takes priority over automatic recalculation.
4. **Schedules** — define the expected work pattern per employee: fixed, flexible, or shift-based, with lunch
   breaks, grace periods (tolerances), extra days off, and rules for pay on out-of-schedule work. The timesheet
   engine evaluates actual attendance against the assigned schedule to determine lateness/absence.

### Payroll
- **Transactions** (`payroll_transactions`) represent an accrual, bonus, fine, or payout.
- **Auto-fines** are generated automatically from timesheet violations (e.g. lateness) and are tagged with an
  `auto_key` so they stay in sync with the timesheet: if an employee's excuse/leave request is later approved,
  the linked auto-fine is automatically reversed.
- Deletions are soft (reversible), never destructive.

### Integrations
- **HikCentral** — the backend polls the HikCentral Professional OpenAPI (Artemis) every 45 seconds per tenant
  to pull face-recognition terminal events.
- **Generic integration API** — any other event source can push attendance events to
  `POST /api/v1/integration/events`, authenticated with a per-tenant API key.
- **Telegram bots** — one bot instance runs per tenant (`bots/manager.py`), handling employee self-service
  (check-in reminders, requests) and manager notifications, in Russian and Uzbek.

## Key Concepts (glossary)

- **Project (tenant)** — a company, addressed by its `slug` in the URL. All data is isolated by `project_id`.
- **Attendance events** (`attendance_events`) — raw events from terminals/Telegram/manual entry. Never deleted,
  only hidden.
- **Timesheet days** (`attendance_days`) — the materialized per-day calculation: status, check-in/out, hours,
  lateness. Recalculated automatically on new events or edits; a manual correction (`is_manual`) takes priority.
- **Schedules** — fixed/flexible/shift-based, with lunch breaks, grace periods, extra days off, and pay rules for
  out-of-schedule work.
- **Transactions** (`payroll_transactions`) — accrual / bonus / fine / payout. Auto-fines carry an `auto_key` and
  stay synced with the timesheet (an approved "valid excuse" request reverses them). Deletion is soft and
  reversible.
- **Integrations** — HikCentral is polled every 45s; any other source can push events to
  `POST /api/v1/integration/events` with an API key.
