import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import dispose_engine, init_engine, new_session
from app.routers import account, auth, chat, health
from app.services.repository import seed_demo_user
from app.services.openshift_ai import OpenShiftAIClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    init_engine(settings.database_url, settings.db_connect_retries, settings.db_connect_retry_seconds)
    with new_session() as db:
        seed_demo_user(db, settings)
    app.state.ai = OpenShiftAIClient(settings)
    yield
    await app.state.ai.aclose()
    dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(chat.router)
    app.include_router(account.router)
    return app


app = create_app()
