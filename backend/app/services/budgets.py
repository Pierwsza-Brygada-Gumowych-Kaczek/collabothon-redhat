"""Monthly budgets the user can add and delete.

A budget tracks one kind of spending, matched either by transaction category (e.g. "Rent") or by
merchant name (counterparty contains a text, e.g. "La Vino"). Its limit is set by the user or, if
left empty, suggested from history: average monthly spend (excluding the June shutdown) +10%,
rounded up to €100.

Budget definitions are stored per user in the database (see app.services.repository); new
users start with the four defaults below, which match the sample data.

Prototype: the data ends in December 2025, so the "current" budget month is the last month in
the statement and "today" is the same day of month as the real date. The reset countdown uses
the real date (budgets reset on the 1st of next month).
"""

from __future__ import annotations

import calendar
import math
from collections import defaultdict
from datetime import date

from app.schemas import Budget, BudgetDefinition, BudgetOption, BudgetOptions
from app.services.statement import CAT_RENT, CAT_REVENUE, CAT_UTILITIES, SHUTDOWN_MONTH, Transaction

PHOTOS = ("food", "beverages", "utilities", "rent")

DEFAULTS = [
    BudgetDefinition(id="food", name="Food & ingredients", description="Asimex wholesale and morning market purchases",
                     merchants=["Asimex", "Wholesale Market"], photo="food"),
    BudgetDefinition(id="beverages", name="Wine & beverages", description="Deliveries from Fattoria La Vino",
                     merchants=["La Vino"], photo="beverages"),
    BudgetDefinition(id="utilities", name="Energy & utilities", description="City Energy & Utilities",
                     category=CAT_UTILITIES, photo="utilities"),
    BudgetDefinition(id="rent", name="Restaurant rent", description="Main Street Real Estate",
                     category=CAT_RENT, photo="rent"),
]


def matches(defn: BudgetDefinition, t: Transaction) -> bool:
    if t.amount_eur >= 0:
        return False
    if defn.category and t.category == defn.category:
        return True
    cp = t.counterparty.lower()
    return any(m.lower() in cp for m in defn.merchants if m)


def suggested_limit(monthly: dict[int, float]) -> float:
    normal = [v for m, v in monthly.items() if m != SHUTDOWN_MONTH]
    avg = sum(normal) / max(len(normal), 1)
    return float(math.ceil(avg * 1.1 / 100) * 100)


def _next_month(d: date) -> date:
    return date(d.year + d.month // 12, d.month % 12 + 1, 1)


def build_budgets(txs: tuple[Transaction, ...], defs: list[BudgetDefinition], today: date) -> list[Budget]:
    last = txs[-1].booking_date
    period_start = date(last.year, last.month, 1)
    demo_today = period_start.replace(day=min(today.day, calendar.monthrange(last.year, last.month)[1]))
    reset_date = _next_month(today)

    result = []
    for d in defs:
        per_month: dict[int, float] = defaultdict(float)
        spent = 0.0
        for t in txs:
            if not matches(d, t):
                continue
            per_month[t.booking_date.month] += -t.amount_eur
            if period_start <= t.booking_date <= demo_today:
                spent += -t.amount_eur
        limit = d.limit if d.limit else suggested_limit(per_month)
        result.append(Budget(
            id=d.id,
            name=d.name,
            description=d.description,
            category=d.category,
            merchants=d.merchants,
            photo=d.photo,
            custom_limit=d.limit is not None,
            limit=limit,
            spent=round(spent, 2),
            remaining=round(limit - spent, 2),
            period_start=period_start,
            reset_date=reset_date,
            reset_in_days=(reset_date - today).days,
        ))
    return result


def build_options(txs: tuple[Transaction, ...]) -> BudgetOptions:
    """What a new budget can track, with a suggested monthly limit for each choice."""
    by_cat: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    by_cp: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for t in txs:
        if t.amount_eur >= 0 or t.category == CAT_REVENUE:
            continue
        by_cat[t.category][t.booking_date.month] += -t.amount_eur
        by_cp[t.counterparty][t.booking_date.month] += -t.amount_eur

    def opts(src: dict[str, dict[int, float]]) -> list[BudgetOption]:
        items = [BudgetOption(value=k, suggested_limit=suggested_limit(v)) for k, v in src.items()]
        return sorted(items, key=lambda o: -o.suggested_limit)

    return BudgetOptions(categories=opts(by_cat), merchants=opts(by_cp), photos=list(PHOTOS))
