"""Liquidity agent: monitors the account, forecasts cash flow N days ahead and proposes
credit facilities when the forecast (or last year's pattern) shows a gap.

Forecast model (transparent on purpose, so a business owner can follow it):
- recurring flows (rent, payroll, social security, utilities, taxes) repeat last year's
  schedule on the same calendar day; the Swiss instalments are finished and not repeated,
- variable flows (card revenue, suppliers, market purchases) use last year's average daily
  net amount for the same month — this captures seasonality incl. the June shutdown,
- the uncertainty band is ±1 standard deviation of daily variable flows, growing with √days.
"""

from __future__ import annotations

import calendar
import math
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from app.schemas import CreditFacility, ForecastPoint, GoalDefinition, LiquidityResponse, ScheduledFlow, TaxFacts
from app.services.agent_base import AgentUnavailable, eur, num, run_agent, str_list
from app.services import demo, goals as goals_svc
from app.services.openshift_ai import OpenShiftAIClient
from app.services.statement import (
    CAT_PAYROLL,
    CAT_RENT,
    CAT_SOCIAL,
    CAT_SWISS,
    CAT_TAXES,
    CAT_UTILITIES,
    SHUTDOWN_MONTH,
    Transaction,
    daily_balances,
)


RECURRING = {CAT_RENT, CAT_PAYROLL, CAT_SOCIAL, CAT_UTILITIES, CAT_TAXES}
UNARRANGED_OVERDRAFT_RATE = 0.12  # indicative cost of an unarranged overdraft
TAX_BACKPAYMENT_DUE = (5, 31)  # assumption: assessment due end of May — adjust when notice arrives


def _short_label(t: Transaction) -> str:
    if t.category == CAT_PAYROLL:
        return "Salaries" if "Owner" not in t.reference else "Owner withdrawal"
    if t.category == CAT_TAXES:
        if "Income Tax" in t.reference:
            return "Income tax prepayment"
        if "Trade Tax" in t.reference:
            return "Trade tax prepayment"
        return "Wage tax"
    return {CAT_RENT: "Rent", CAT_SOCIAL: "Social security", CAT_UTILITIES: "Energy & utilities"}.get(
        t.category, t.category
    )


def overdraft_cost(txs: tuple[Transaction, ...], opening: float) -> float:
    """Interest an unarranged overdraft would have cost over the statement period."""
    daily = daily_balances(txs, opening)
    d, end = txs[0].booking_date, txs[-1].booking_date
    bal, cost = opening, 0.0
    while d <= end:
        bal = daily.get(d, bal)
        cost += max(-bal, 0) * UNARRANGED_OVERDRAFT_RATE / 365
        d += timedelta(days=1)
    return round(cost, 2)


def forecast(
    txs: tuple[Transaction, ...],
    opening: float,
    days: int,
    tax: TaxFacts | None = None,
    goals: list[GoalDefinition] | None = None,
) -> tuple[list[ForecastPoint], list[ScheduledFlow]]:
    as_of = txs[-1].booking_date
    goal_by_day = goals_svc.goal_flows(goals or [], as_of, days)
    balance = daily_balances(txs, opening)[as_of]

    recurring: dict[tuple[int, int], list[Transaction]] = defaultdict(list)
    variable_by_day: dict[date, float] = defaultdict(float)
    income_by_month: dict[int, float] = defaultdict(float)
    for t in txs:
        if t.amount_eur > 0:
            income_by_month[t.booking_date.month] += t.amount_eur
        if t.category == CAT_SWISS:
            continue
        if t.category in RECURRING:
            recurring[(t.booking_date.month, t.booking_date.day)].append(t)
        else:
            variable_by_day[t.booking_date] += t.amount_eur

    month_out: dict[int, float] = {}  # average daily variable money out (suppliers, market) per month
    month_in: dict[int, float] = {}  # average daily money in (card revenue) per month
    for m in range(1, 13):
        n_days = calendar.monthrange(as_of.year, m)[1]
        month_in[m] = income_by_month[m] / n_days
        month_out[m] = sum(v for d, v in variable_by_day.items() if d.month == m) / n_days - month_in[m]

    # Card revenue follows a weekly rhythm: credit-card payouts arrive on Mon/Tue/Fri, debit-card
    # settlements daily. weekday_factor[w] = average income on weekday w / average daily income
    # (normal months only), so expected income = month level x weekday shape.
    income_by_day: dict[date, float] = defaultdict(float)
    for t in txs:
        if t.amount_eur > 0:
            income_by_day[t.booking_date] += t.amount_eur
    wd_sum, wd_n = [0.0] * 7, [0] * 7
    d = txs[0].booking_date
    while d <= as_of:
        if d.month != SHUTDOWN_MONTH:
            wd_sum[d.weekday()] += income_by_day.get(d, 0.0)
            wd_n[d.weekday()] += 1
        d += timedelta(days=1)
    wd_avg = [wd_sum[i] / max(wd_n[i], 1) for i in range(7)]
    overall = sum(wd_avg) / 7 or 1.0
    weekday_factor = [v / overall for v in wd_avg]

    normal_days = []
    d = txs[0].booking_date
    while d <= as_of:
        if d.month != SHUTDOWN_MONTH:
            normal_days.append(variable_by_day.get(d, 0.0))
        d += timedelta(days=1)
    sigma = statistics.pstdev(normal_days) if len(normal_days) > 1 else 0.0

    points: list[ForecastPoint] = []
    scheduled: list[ScheduledFlow] = []
    for k in range(1, days + 1):
        day = as_of + timedelta(days=k)
        expected_in = month_in[day.month] * weekday_factor[day.weekday()]
        balance += expected_in + month_out[day.month]
        for t in recurring.get((day.month, day.day), []):
            amount = t.amount_eur
            label = _short_label(t)
            if tax and label == "Income tax prepayment":
                amount = -tax.recommended_quarterly_prepayment
                label += " (adjusted)"
            elif tax and label == "Trade tax prepayment":
                amount = -round(tax.estimated_trade_tax / 4, -1)
                label += " (adjusted)"
            balance += amount
            scheduled.append(ScheduledFlow(date=day, label=label, amount=round(amount, 2)))
        for label, amount in goal_by_day.get(day, []):
            balance -= amount
            scheduled.append(ScheduledFlow(date=day, label=label, amount=-round(amount, 2)))
        if tax and (day.month, day.day) == TAX_BACKPAYMENT_DUE:
            balance -= tax.estimated_additional_payment
            scheduled.append(ScheduledFlow(date=day, label="Expected tax back-payment (assumed date)",
                                           amount=-tax.estimated_additional_payment))
        band = sigma * math.sqrt(k)
        points.append(ForecastPoint(date=day, balance=round(balance, 2),
                                    low=round(balance - band, 2), high=round(balance + band, 2),
                                    expected_in=round(expected_in, 2)))

    # Merge same-day, same-label flows (e.g. four salary payments on the 28th).
    merged: dict[tuple[date, str], float] = defaultdict(float)
    for s in scheduled:
        merged[(s.date, s.label)] += s.amount
    flows = [ScheduledFlow(date=d, label=lbl, amount=round(a, 2)) for (d, lbl), a in sorted(merged.items())]
    return points, flows


SYSTEM_PROMPT = """You are the liquidity agent of a bank's AI CFO for small businesses. You get
a cash-flow forecast for the client's business account and last year's overdraft history.
Explain the outlook and, if there is a funding gap (or a seasonal one like last year),
automatically propose suitable bank credit facilities: arranged overdraft / business credit
line, short-term working-capital loan, seasonal credit line. Size them to the gap plus a
buffer. Interest rates are indicative ranges, not offers.
Reply ONLY with valid JSON (no markdown) in this schema:
{
  "summary": "2-3 simple sentences on the cash outlook",
  "facilities": [
    {
      "title": "short name",
      "product": "bank product name, e.g. Business credit line",
      "limit_eur": 30000,
      "term": "e.g. 12 months, renewable",
      "interest_min_pct": 8.0,
      "interest_max_pct": 11.0,
      "est_cost_eur": 500,
      "plain_explanation": "1-2 sentences for a layperson",
      "rationale": "why, based on the forecast numbers",
      "steps": ["step 1", "step 2"]
    }
  ],
  "warnings": ["short plain warnings"]
}
Give 1-3 facilities (or an empty list if no gap at all), most important first."""


def build_context(
    res: LiquidityResponse, last_year_min: float, last_year_overdraft_days: int, tax: TaxFacts | None
) -> str:
    tax_line = (
        f"yes — expected back-payment {eur(tax.estimated_additional_payment)} and higher prepayments"
        if tax else "no (current prepayments only)"
    )
    goal_out = [s for s in res.scheduled if s.label.startswith("Goal: ")]
    goal_line = (
        f"Savings goals included: {eur(-sum(s.amount for s in goal_out))} is set aside for "
        f"{', '.join(sorted({s.label[6:] for s in goal_out}))} within the horizon (already in the forecast)."
        if goal_out else "No savings goals are scheduled."
    )
    big = sorted(res.scheduled, key=lambda s: s.amount)[:8]
    flows = "\n".join(f"- {s.date}: {s.label} {eur(s.amount)}" for s in big)
    return f"""Forecast as of {res.as_of}, horizon {res.days} days.
Current balance: {eur(res.opening_balance)}
Forecast lowest balance: {eur(res.min_balance)} on {res.min_balance_date}
Forecast days below zero: {res.days_below_zero}
Forecast end balance: {eur(res.end_balance)}
Last year: lowest balance {eur(last_year_min)}, {last_year_overdraft_days} days in overdraft,
estimated unarranged-overdraft interest {eur(res.overdraft_cost_last_year)}.
The restaurant closes for 3 weeks every June (no revenue).
Tax changes included in the forecast: {tax_line}
{goal_line}
Largest scheduled outflows in the horizon:
{flows}"""


async def generate(
    ai: OpenShiftAIClient,
    txs: tuple[Transaction, ...],
    opening: float,
    days: int,
    tax: TaxFacts | None,
    last_year_min: float,
    last_year_overdraft_days: int,
    demo_fallback: bool = False,
    goals: list[GoalDefinition] | None = None,
) -> LiquidityResponse:
    """The forecast is calculated; the outlook text and credit facilities come from the model only."""
    points, flows = forecast(txs, opening, days, tax, goals)
    low = min(points, key=lambda p: p.balance)
    base = LiquidityResponse(
        source="unavailable",
        model=ai.model,
        generated_at=datetime.now(timezone.utc),
        as_of=txs[-1].booking_date,
        days=days,
        opening_balance=round(daily_balances(txs, opening)[txs[-1].booking_date], 2),
        forecast=points,
        scheduled=flows,
        min_balance=low.balance,
        min_balance_date=low.date,
        days_below_zero=sum(1 for p in points if p.balance < 0),
        end_balance=points[-1].balance,
        overdraft_cost_last_year=overdraft_cost(txs, opening),
        facilities=[],
    )

    def from_model(data: dict) -> LiquidityResponse:
        facilities = []
        for f in data.get("facilities", []):
            if not isinstance(f, dict):
                continue
            lo, hi = num(f.get("interest_min_pct")), num(f.get("interest_max_pct"))
            f.update(limit_eur=max(num(f.get("limit_eur")), 0), est_cost_eur=num(f.get("est_cost_eur")),
                     interest_min_pct=min(lo, hi), interest_max_pct=max(lo, hi),
                     steps=str_list(f.get("steps", [])))
            facilities.append(CreditFacility(**f))
        if not data.get("summary"):
            raise ValueError("the reply contains no summary")
        return base.model_copy(update={
            "source": "openshift-ai", "summary": str(data["summary"]),
            "facilities": facilities, "warnings": [str(w) for w in data.get("warnings", [])],
        })

    context = build_context(base, last_year_min, last_year_overdraft_days, tax)
    try:
        return await run_agent(ai, "liquidity", SYSTEM_PROMPT, context, from_model)
    except AgentUnavailable as exc:
        if demo_fallback:
            return demo.liquidity(base, last_year_min, tax).model_copy(update={"error": str(exc)})
        return base.model_copy(update={"error": str(exc)})
