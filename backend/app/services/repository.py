"""Reading and writing a user's data in the database (transactions, budgets) + demo seeding."""

from __future__ import annotations

import logging
import re

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import BudgetRow, TransactionRow, UserRow
from app.schemas import BudgetCreate, BudgetDefinition
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


# --- Budgets ------------------------------------------------------------------------------


def _to_def(r: BudgetRow) -> BudgetDefinition:
    return BudgetDefinition(id=r.slug, name=r.name, description=r.description, category=r.category,
                            merchants=list(r.merchants or []), limit=r.limit, photo=r.photo)


def list_budgets(db: Session, user_id: int) -> list[BudgetDefinition]:
    rows = db.scalars(select(BudgetRow).where(BudgetRow.user_id == user_id).order_by(BudgetRow.position, BudgetRow.id))
    return [_to_def(r) for r in rows]


def add_budget(db: Session, user_id: int, body: BudgetCreate, slug: str | None = None) -> BudgetDefinition:
    base = slug or re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-") or "budget"
    taken = set(db.scalars(select(BudgetRow.slug).where(BudgetRow.user_id == user_id)))
    new, n = base, 2
    while new in taken:
        new, n = f"{base}-{n}", n + 1
    position = (db.scalar(select(func.max(BudgetRow.position)).where(BudgetRow.user_id == user_id)) or 0) + 1
    row = BudgetRow(user_id=user_id, slug=new, position=position, **body.model_dump())
    db.add(row)
    db.commit()
    return _to_def(row)


def delete_budget(db: Session, user_id: int, slug: str) -> bool:
    res = db.execute(delete(BudgetRow).where(BudgetRow.user_id == user_id, BudgetRow.slug == slug))
    db.commit()
    return res.rowcount > 0


# --- Demo user ----------------------------------------------------------------------------


def seed_demo_user(db: Session, settings: Settings) -> None:
    """Create the demo user (demo / demo) with the sample statement and default budgets, once."""

    if db.scalar(select(UserRow).where(UserRow.username == settings.demo_username)):
        return
    try:
        _create_demo_user(db, settings)
    except IntegrityError:
        # Another backend replica created it at the same moment — that is fine.
        db.rollback()
        log.info("Demo user already created by another instance")


def _create_demo_user(db: Session, settings: Settings) -> None:
    from app.services.budgets import DEFAULTS

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
    for d in DEFAULTS:
        add_budget(db, user.id, BudgetCreate(**d.model_dump(exclude={"id"})), slug=d.id)
    log.info("Created demo user '%s' with %d transactions", user.username, count)
