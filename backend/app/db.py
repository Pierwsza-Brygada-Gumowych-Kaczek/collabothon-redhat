"""Database: users, login sessions, bank transactions and goals.

SQLite by default (file next to the backend). On OpenShift set DATABASE_URL to PostgreSQL,
e.g. postgresql+psycopg://user:pass@postgresql:5432/duckbank (add the psycopg driver).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


log = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


class UserRow(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(120))
    business: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    segment: Mapped[str] = mapped_column(String(80), default="")
    # Balance before the first imported transaction.
    opening_balance: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SessionRow(Base):
    __tablename__ = "sessions"

    # SHA-256 of the session token (the token itself is only in the user's cookie).
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class TransactionRow(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    booking_date: Mapped[date] = mapped_column(Date, index=True)
    tx_type: Mapped[str] = mapped_column(String(80))
    reference: Mapped[str] = mapped_column(String(300))
    counterparty: Mapped[str] = mapped_column(String(200))
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3))
    amount_eur: Mapped[float] = mapped_column(Float)
    fx_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    category: Mapped[str] = mapped_column(String(60))
    account: Mapped[str] = mapped_column(String(40))


class GoalRow(Base):
    __tablename__ = "goals"
    __table_args__ = (UniqueConstraint("user_id", "slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    slug: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(String(120), default="")
    target: Mapped[float] = mapped_column(Float)
    saved: Mapped[float] = mapped_column(Float, default=0.0)
    deadline_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    photo: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # The chosen way to reach the goal (JSON of GoalWay), if any.
    way: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created: Mapped[date] = mapped_column(Date, default=date.today)
    position: Mapped[int] = mapped_column(Integer, default=0)


_engine: Engine | None = None
_factory: sessionmaker[Session] | None = None


def _add_missing_columns(engine: Engine) -> None:
    """create_all() never alters existing tables; add columns that newer versions introduced."""
    existing = {c["name"] for c in inspect(engine).get_columns("goals")}
    if "icon" not in existing:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE goals ADD COLUMN icon VARCHAR(30)"))


def init_engine(url: str, retries: int = 1, retry_seconds: float = 2.0) -> Engine:
    """Create the engine and tables (idempotent).

    In docker compose / Kubernetes the database may still be starting, so connection errors are
    retried `retries` times before giving up.
    """
    global _engine, _factory
    if url.startswith("sqlite:///"):
        Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True, future=True)
    for attempt in range(1, max(retries, 1) + 1):
        try:
            Base.metadata.create_all(engine)
            _add_missing_columns(engine)
            break
        except OperationalError as exc:
            if attempt >= retries:
                raise
            log.warning("Database not ready (%s/%s): %s", attempt, retries, str(exc).splitlines()[0])
            time.sleep(retry_seconds)
    _engine = engine
    _factory = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def dispose_engine() -> None:
    global _engine, _factory
    if _engine is not None:
        _engine.dispose()
    _engine, _factory = None, None


def new_session() -> Session:
    if _factory is None:
        raise RuntimeError("Database not initialised")
    return _factory()


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one DB session per request."""
    db = new_session()
    try:
        yield db
    finally:
        db.close()
