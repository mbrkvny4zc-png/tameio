"""FastAPI application entry point.  Run: uvicorn app.main:app --reload"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.auth import router as auth_router
from app.db import ensure_indexes
from app.notify import router as notify_router
from app.plans import router as plans_router
from app.routers import account, assistant, bank, catalog, delivery, lookup, onboarding, partners, pos, shops, business, documents, expenses, inbox, invoices, mydata, payments, practice, received, reports, suppliers, taxes, team

log = logging.getLogger("scheduler")


async def run_jobs() -> dict:
    return {
        "overdue": await invoices.flag_overdue(),
        "recurring": await invoices.run_recurring(),
        "supplier_reminders": await suppliers.check_supplier_expiries(),
        "payment_reminders": await payments.send_due_reminders(),
        "tax_reminders": await taxes.tax_reminders(),
    }


async def _scheduler():
    await asyncio.sleep(10)
    while True:
        try:
            log.info("jobs: %s", await run_jobs())
        except Exception as e:  # noqa: BLE001 — keep the loop alive
            log.exception("scheduler error: %s", e)
        await asyncio.sleep(1800)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_indexes()
    task = asyncio.create_task(_scheduler()) if config.SCHEDULER_ENABLED else None
    yield
    if task:
        task.cancel()


def create_app(with_lifespan: bool = True) -> FastAPI:
    app = FastAPI(title=f"{config.APP_NAME} API", lifespan=lifespan if with_lifespan else None)
    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])
    api = APIRouter(prefix="/api")
    for r in (auth_router, notify_router, business.router, invoices.router, documents.router, mydata.router,
              suppliers.router, expenses.router, reports.router, plans_router, team.router, practice.router, received.router, payments.router, bank.router, inbox.router, taxes.router, account.router,
              lookup.router, catalog.router, delivery.router, assistant.router, onboarding.router, shops.router, pos.router, partners.router):
        api.include_router(r)

    @api.get("/health")
    async def health():
        return {"ok": True, "app": config.APP_NAME}

    app.include_router(api)
    return app


app = create_app()
