"""Reading and writing a user's data in the database (transactions, goals) + demo seeding."""

from __future__ import annotations

import logging
import re

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from datetime import date

from app.db import GoalRow, TransactionRow, UserRow
from app.schemas import GoalCreate, GoalDefinition
from app.services.auth import hash_password
from app.services.statement import Transaction, parse_csv

log = logging.getLogger(__name__)


# --- Transactions -------------------------------------------------------------------------


def user_transactions(db: Session, user_id: int) -> tuple[Transaction, ...]:
    """All transactions of a user, oldest first (same order as the imported statement)."""
    rows = db.scalars(
        select(TransactionRow).where(TransactionRow.user_id == user_id)
        .order_by(TransactionRow.booking_date, TransactionRow.id)
    )
    return tuple(
        Transaction(
            booking_date=r.booking_date, tx_type=r.tx_type, reference=r.reference,
            counterparty=r.counterparty, amount=r.amount, currency=r.currency,
            amount_eur=r.amount_eur, fx_rate=r.fx_rate, category=r.category, account=r.account,
        )
        for r in rows
    )


def import_transactions(db: Session, user_id: int, txs: tuple[Transaction, ...]) -> int:
    db.add_all(
        TransactionRow(
            user_id=user_id, booking_date=t.booking_date, tx_type=t.tx_type, reference=t.reference,
            counterparty=t.counterparty, amount=t.amount, currency=t.currency,
            amount_eur=t.amount_eur, fx_rate=t.fx_rate, category=t.category, account=t.account,
        )
        for t in txs
    )
    db.commit()
    return len(txs)


# --- Goals --------------------------------------------------------------------------------


def _goal_def(r: GoalRow) -> GoalDefinition:
    return GoalDefinition(
        id=r.slug, name=r.name, description=r.description, target=r.target, saved=r.saved,
        deadline_months=r.deadline_months, photo=r.photo, icon=r.icon, way=r.way, created=r.created,
    )


def list_goals(db: Session, user_id: int) -> list[GoalDefinition]:
    rows = db.scalars(select(GoalRow).where(GoalRow.user_id == user_id).order_by(GoalRow.position, GoalRow.id))
    return [_goal_def(r) for r in rows]


def add_goal(db: Session, user_id: int, body: GoalCreate) -> GoalDefinition:
    base = re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-") or "goal"
    taken = set(db.scalars(select(GoalRow.slug).where(GoalRow.user_id == user_id)))
    new, n = base, 2
    while new in taken:
        new, n = f"{base}-{n}", n + 1
    position = (db.scalar(select(func.max(GoalRow.position)).where(GoalRow.user_id == user_id)) or 0) + 1
    row = GoalRow(user_id=user_id, slug=new, position=position, created=date.today(), **body.model_dump(mode="json"))
    db.add(row)
    db.commit()
    return _goal_def(row)


def update_goal(db: Session, user_id: int, slug: str, body: GoalCreate) -> GoalDefinition | None:
    row = db.scalar(select(GoalRow).where(GoalRow.user_id == user_id, GoalRow.slug == slug))
    if row is None:
        return None
    for key, value in body.model_dump(mode="json").items():
        setattr(row, key, value)
    db.commit()
    return _goal_def(row)


def delete_goal(db: Session, user_id: int, slug: str) -> bool:
    res = db.execute(delete(GoalRow).where(GoalRow.user_id == user_id, GoalRow.slug == slug))
    db.commit()
    return res.rowcount > 0


# --- Demo user ----------------------------------------------------------------------------


def seed_demo_user(db: Session, settings: Settings) -> None:
    """Create the demo user (demo / demo) with the sample statement, once."""

    if db.scalar(select(UserRow).where(UserRow.username == settings.demo_username)):
        return
    try:
        _create_demo_user(db, settings)
    except IntegrityError:
        # Another backend replica created it at the same moment — that is fine.
        db.rollback()
        log.info("Demo user already created by another instance")


def _create_demo_user(db: Session, settings: Settings) -> None:
    user = UserRow(
        username=settings.demo_username,
        password_hash=hash_password(settings.demo_password),
        name=settings.demo_name,
        business=settings.demo_business,
        email=settings.demo_email,
        segment=settings.demo_segment,
        opening_balance=settings.statement_opening_balance,
    )
    db.add(user)
    db.commit()
    count = import_transactions(db, user.id, parse_csv(settings.statement_csv_path))
    log.info("Created demo user '%s' with %d transactions", user.username, count)
