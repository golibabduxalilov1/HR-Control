import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routers import (
    attendance,
    auth,
    dashboard,
    devices_integrations,
    employees,
    payroll,
    platform,
    public_api,
    requests_tasks,
    schedules,
    settings as settings_router,
    structure,
)
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = get_settings()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    from app.db.seed import ensure_columns, ensure_platform_admin

    await ensure_columns()
    await ensure_platform_admin()
    if cfg.telegram_polling_enabled:
        try:
            from app.bots.manager import bot_manager
            await bot_manager.start_all()
        except Exception as exc:  # noqa: BLE001
            log.warning("bots not started: %s", exc)
    from app.services.scheduler import start_scheduler, stop_scheduler
    start_scheduler()
    yield
    stop_scheduler()
    try:
        from app.bots.manager import bot_manager
        await bot_manager.stop_all()
    except Exception:  # noqa: BLE001
        pass
    await engine.dispose()


app = FastAPI(title=get_settings().app_name, version="1.0.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origin_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

api = APIRouter(prefix="/api")
for r in (auth.router, structure.router, employees.router, schedules.router, attendance.router, payroll.router, dashboard.router,
          settings_router.router, requests_tasks.router, devices_integrations.router, platform.router, public_api.router, public_api.v1):
    api.include_router(r)
app.include_router(api)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Внутренняя ошибка сервера"})


@app.get("/api/health")
async def health():
    return {"ok": True}
