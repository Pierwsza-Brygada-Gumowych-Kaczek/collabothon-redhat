"""Monthly budgets for selected spending types.

Limit = average monthly spend in the category (excluding June, when the restaurant was closed)
+10%, rounded up to €100.

Prototype: the data ends in December 2025, so the "current" budget month is the last month in
the statement and "today" is the same day of month as the real date. The reset countdown uses
the real date (budgets reset on the 1st of next month).
"""

from __future__ import annotations

import calendar
import math
from collections import defaultdict
from collections.abc import Callable
from datetime import date

from app.schemas import Budget
from app.services.statement import CAT_RENT, CAT_UTILITIES, SHUTDOWN_MONTH, Transaction

# id, name, description, transaction matcher
BUDGETS: list[tuple[str, str, str, Callable[[Transaction], bool]]] = [
    (
        "food",
        "Food & ingredients",
        "Asimex wholesale and morning market purchases",
        lambda t: "Asimex" in t.counterparty or "Wholesale Market" in t.counterparty,
    ),
    (
        "beverages",
        "Wine & beverages",
        "Deliveries from Fattoria La Vino",
        lambda t: "La Vino" in t.counterparty,
    ),
    (
        "utilities",
        "Energy & utilities",
        "City Energy & Utilities",
        lambda t: t.category == CAT_UTILITIES,
    ),
    (
        "rent",
        "Restaurant rent",
        "Main Street Real Estate",
        lambda t: t.category == CAT_RENT,
    ),
]



def _next_month(d: date) -> date:
    return date(d.year + d.month // 12, d.month % 12 + 1, 1)


def build_budgets(txs: tuple[Transaction, ...], today: date) -> list[Budget]:
    last = txs[-1].booking_date
    period_start = date(last.year, last.month, 1)
    demo_today = period_start.replace(
        day=min(today.day, calendar.monthrange(last.year, last.month)[1])
    )
    reset_date = _next_month(today)

    result = []
    for bid, name, desc, match in BUDGETS:
        per_month: dict[int, float] = defaultdict(float)
        spent = 0.0
        for t in txs:
            if t.amount_eur >= 0 or not match(t):
                continue
            per_month[t.booking_date.month] += -t.amount_eur
            if period_start <= t.booking_date <= demo_today:
                spent += -t.amount_eur
        normal = [v for m, v in per_month.items() if m != SHUTDOWN_MONTH]
        avg = sum(normal) / max(len(normal), 1)
        limit = float(math.ceil(avg * 1.1 / 100) * 100)
        result.append(
            Budget(
                id=bid,
                name=name,
                description=desc,
                limit=limit,
                spent=round(spent, 2),
                remaining=round(limit - spent, 2),
                period_start=period_start,
                reset_date=reset_date,
                reset_in_days=(reset_date - today).days,
            )
        )
    return result
