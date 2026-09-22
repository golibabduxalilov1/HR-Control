# Face ID Workplace — учёт рабочего времени и персонала

Мультитенантная система учёта посещаемости по терминалам распознавания лиц (HikCentral), расчёта зарплаты,
штрафов и бонусов, с Telegram-ботами для сотрудников и руководителей. Аналог sputnikface.uz, спроектированный заново.

## Стек

| Слой | Технологии |
|------|-----------|
| Backend | Python 3.13 · FastAPI · SQLAlchemy 2 (async) · PostgreSQL (prod) / SQLite (dev) · APScheduler · aiogram 3 |
| Frontend | React 19 · Vite · TypeScript · Tailwind 4 · TanStack Query · react-router 7 · recharts · i18next (ru/uz) |
| Интеграции | HikCentral Professional OpenAPI (Artemis) · Telegram Bot API · read-only Integration API + inbound webhook |

## Быстрый старт (dev)

```bash
# backend
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt
cp .env.example .env                       # SQLite по умолчанию
.venv/Scripts/python -m app.db.seed demo   # демо-компания: /demo, admin / admin
.venv/Scripts/python -m uvicorn app.main:app --port 8000 --reload

# frontend
cd frontend && npm install && npm run dev  # http://localhost:5173/demo
```

Или через PowerShell-помощник: `.\dev.ps1 seed`, `.\dev.ps1 backend`, `.\dev.ps1 frontend`, `.\dev.ps1 test`.

- Кабинет компании: `http://localhost:5173/<slug>` (демо: `/demo`, логин `admin` / `admin`, оператор `oper` / `admin`)
- Панель платформы (создание компаний, лицензии): `http://localhost:5173/workplace` (логин `platform` / `platform`, см. `.env`)
- Swagger: `http://localhost:8000/api/docs`

## Production

```bash
# backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# frontend
cd frontend && npm install && npm run build   # раздать содержимое dist/ через любой веб-сервер
```

Обязательно задайте `SECRET_KEY`, `PLATFORM_ADMIN_PASSWORD`, `DATABASE_URL` (PostgreSQL). SQLite годится только для разработки —
в этом режиме запросы к БД сериализуются.

## Структура

```
backend/app
  core/        config, security (JWT/bcrypt), deps (auth & tenant), project_settings (настройки тенанта по умолчанию)
  models/      SQLAlchemy-модели (все tenant-таблицы с project_id)
  schemas/     Pydantic
  api/routers/ auth, structure, employees, schedules, attendance, payroll, dashboard, settings, requests_tasks,
               devices_integrations, platform (/workplace), public_api (+ /v1/integration)
  services/    timesheet (движок табеля), payroll (начисления, автоштрафы), audit, files, scheduler
  integrations/ hikcentral (OpenAPI клиент + синхронизация), ingest (единая точка приёма проходов)
  bots/        manager (polling per tenant), handlers (aiogram), notify, templates ru/uz
frontend/src
  pages/       Dashboard, Today, Structure, Employees (+Drawer, +Form), Schedules, Timesheet, Payroll, Tasks,
               Notifications, Settings, Workplace, Login
  components/  ui (модалки, селекты, toast, KPI...), layout (AppLayout с сайдбаром)
docs/ARCHITECTURE.md — модель данных, алгоритмы табеля и зарплаты, чем система лучше оригинала
```

## Ключевые понятия

- **Проект (тенант)** — компания; адресуется slug в URL. Все данные изолированы по `project_id`.
- **Проходы** (`attendance_events`) — сырые события с терминалов/Telegram/вручную. Никогда не удаляются, только скрываются.
- **Дни табеля** (`attendance_days`) — материализованный расчёт по дню: статус, вход/выход, часы, опоздание. Пересчитываются
  автоматически при новых проходах и правках; ручная правка (`is_manual`) имеет приоритет.
- **Графики** — фиксированные/гибкие/сменные, с обедом, допусками, доп. выходными, оплатой вне графика.
- **Операции** (`payroll_transactions`) — начисление / бонус / штраф / выплата. Автоштрафы имеют `auto_key` и
  синхронизируются с табелем (принятая заявка «уважительная причина» их снимает). Удаление — мягкое, с восстановлением.
- **Интеграции** — HikCentral опрашивается каждые 45 с; любой другой источник может слать события в
  `POST /api/v1/integration/events` с API-ключом.
