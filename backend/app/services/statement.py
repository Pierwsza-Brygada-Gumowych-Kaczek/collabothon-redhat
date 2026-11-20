"""Loading and analysing the bank statement (German online-banking CSV, ';' separator)."""

from __future__ import annotations

import csv
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

from app.schemas import (
    AccountOverview,
    CategoryTotal,
    DailyBalance,
    Kpis,
    MonthlySummary,
    TransactionOut,
)

_CHF_RATE = re.compile(r"@\s*([\d.]+)\s*EUR/CHF")

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
SHUTDOWN_MONTH = 6  # the pizzeria closes for 3 weeks every June

# Category names (shared with the agents).
CAT_REVENUE = "Card revenue"
CAT_PAYROLL = "Payroll"
CAT_SUPPLIERS = "Suppliers & goods"
CAT_RENT = "Rent"
CAT_SWISS = "Swiss investment"
CAT_TAXES = "Taxes"
CAT_SOCIAL = "Social security"
CAT_UTILITIES = "Utilities & energy"
CAT_OTHER = "Other"


@dataclass(frozen=True)
class Transaction:
    booking_date: date
    tx_type: str
    reference: str
    counterparty: str
    amount: float  # in original currency
    currency: str
    amount_eur: float  # converted to EUR
    fx_rate: float | None  # EUR per 1 unit of foreign currency
    category: str
    account: str


def _categorize(tx_type: str, reference: str) -> str:
    ref = reference.lower()
    if tx_type in ("CARD SETTLEMENT (DEBIT)", "CREDIT CARD PAYOUT"):
        return CAT_REVENUE
    if tx_type == "SALARY PAYMENT":
        return CAT_PAYROLL
    if tx_type in ("SUPPLIER PAYMENT", "GIRO CARD PAYMENT"):
        return CAT_SUPPLIERS
    if tx_type == "RENT PAYMENT":
        return CAT_RENT
    if tx_type == "INTERNATIONAL WIRE TRANSFER":
        return CAT_SWISS
    if tx_type == "TAX OFFICE TRANSFER" or "tax" in ref:
        return CAT_TAXES
    if "social security" in ref:
        return CAT_SOCIAL
    if "energy" in ref or "utilities" in ref:
        return CAT_UTILITIES
    return CAT_OTHER


def _fx_rate(currency: str, reference: str) -> float | None:
    if currency == "CHF" and (m := _CHF_RATE.search(reference)):
        return float(m.group(1))
    return None


@lru_cache
def load_transactions(path: str) -> tuple[Transaction, ...]:
    """Transactions sorted by date ascending (stable w.r.t. intra-day file order)."""
    with Path(path).open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh, delimiter=";"))

    txs: list[Transaction] = []
    for r in reversed(rows):  # the file lists newest first
        amount = float(r["Amount"].replace(".", "").replace(",", "."))
        currency = r["Currency"]
        reference = r["Payment Reference"]
        rate = _fx_rate(currency, reference)
        txs.append(
            Transaction(
                booking_date=datetime.strptime(r["Booking Date"], "%d.%m.%y").date(),
                tx_type=r["Transaction Type"],
                reference=reference,
                counterparty=r["Beneficiary/Payer"],
                amount=amount,
                currency=currency,
                amount_eur=round(amount * rate, 2) if rate else amount,
                fx_rate=rate,
                category=_categorize(r["Transaction Type"], reference),
                account=r["Account Number"],
            )
        )
    txs.sort(key=lambda t: t.booking_date)
    return tuple(txs)


def to_out(t: Transaction) -> TransactionOut:
    return TransactionOut(
        date=t.booking_date,
        type=t.tx_type,
        reference=t.reference,
        counterparty=t.counterparty,
        amount=t.amount,
        currency=t.currency,
        amount_eur=t.amount_eur,
        category=t.category,
    )


def daily_balances(txs: tuple[Transaction, ...], opening_balance: float) -> dict[date, float]:
    balance = opening_balance
    daily: dict[date, float] = {}
    for t in txs:
        balance += t.amount_eur
        daily[t.booking_date] = balance
    return daily


def build_overview(txs: tuple[Transaction, ...], opening_balance: float) -> AccountOverview:
    monthly_in: dict[int, float] = defaultdict(float)
    monthly_out: dict[int, float] = defaultdict(float)
    monthly_end: dict[int, float] = {}
    categories: dict[str, float] = defaultdict(float)

    daily = daily_balances(txs, opening_balance)
    for t in txs:
        m = t.booking_date.month
        if t.amount_eur >= 0:
            monthly_in[m] += t.amount_eur
        else:
            monthly_out[m] += -t.amount_eur
        categories[t.category] += t.amount_eur
    for d, b in sorted(daily.items()):
        monthly_end[d.month] = b
    balance = daily[max(daily)]

    daily_list = [DailyBalance(date=d, balance=round(b, 2)) for d, b in sorted(daily.items())]
    min_point = min(daily_list, key=lambda p: p.balance)
    total_in = sum(monthly_in.values())
    total_out = sum(monthly_out.values())
    months = sorted(set(monthly_in) | set(monthly_out))

    monthly = [
        MonthlySummary(
            month=f"{txs[0].booking_date.year}-{m:02d}",
            label=MONTHS[m - 1],
            income=round(monthly_in[m], 2),
            expenses=round(monthly_out[m], 2),
            net=round(monthly_in[m] - monthly_out[m], 2),
            end_balance=round(monthly_end[m], 2),
        )
        for m in months
    ]
    operating = [monthly_in[m] for m in months if m != SHUTDOWN_MONTH]
    swiss = [t for t in txs if t.category == CAT_SWISS]

    return AccountOverview(
        account_iban=txs[0].account,
        currency="EUR",
        period_from=txs[0].booking_date,
        period_to=txs[-1].booking_date,
        opening_balance=round(opening_balance, 2),
        balance=round(balance, 2),
        kpis=Kpis(
            total_income=round(total_in, 2),
            total_expenses=round(total_out, 2),
            net_result=round(total_in - total_out, 2),
            min_balance=min_point.balance,
            min_balance_date=min_point.date,
            overdraft_days=sum(1 for p in daily_list if p.balance < 0),
            avg_monthly_income=round(sum(operating) / max(len(operating), 1), 2),
            avg_monthly_expenses=round(total_out / max(len(monthly), 1), 2),
            swiss_transfers_eur=round(-sum(t.amount_eur for t in swiss), 2),
            swiss_transfers_count=len(swiss),
        ),
        monthly=monthly,
        daily_balance=daily_list,
        categories=sorted(
            (CategoryTotal(name=k, amount=round(v, 2)) for k, v in categories.items()),
            key=lambda c: c.amount,
        ),
    )
