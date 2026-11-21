"""Savings goals: the AI proposes ways to fill a goal, the numbers are calculated here.

The model chooses WHICH ways make sense (monthly saving, savings account, fixed-term deposit,
money market fund, ETF plan, …) and writes the explanations. How long each way takes, how much
has to be paid in total and how much interest it earns is computed deterministically from the
payment, its frequency and the middle of the return range — never taken from the model.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

from app.schemas import (
    AccountOverview,
    Goal,
    GoalDefinition,
    GoalPlanRequest,
    GoalPlanResponse,
    GoalWay,
)
from app.services.agent_base import AgentUnavailable, eur, num, pick, run_agent
from app.services.openshift_ai import OpenShiftAIClient

# Icons a goal can use (keys match the frontend catalogue in goal-icons.ts).
GOAL_ICONS = (
    "piggy-bank", "shield", "house", "car", "plane", "graduation-cap",
    "laptop", "chef-hat", "heart-pulse", "gift", "trending-up", "rocket",
)

PERIODS_PER_YEAR = {"weekly": 52, "monthly": 12, "quarterly": 4}
MAX_MONTHS = 600  # 50 years; longer = "not reachable"
_FREQ = {"one-off": "one-off", "once": "one-off", "weekly": "weekly", "monthly": "monthly", "quarterly": "quarterly"}
_RISK = {"low": "low", "medium": "medium", "high": "high"}

SYSTEM_PROMPT = """You are the goals agent of a bank's AI CFO for small businesses.
The owner wants to reach a savings goal (for example new kitchen equipment, a reserve or a
holiday). Propose 4-5 DIFFERENT ways to fill it, safest first, such as: regular saving into the
current account or a savings account, a fixed-term deposit (one-off), a money market fund with
monthly payments, a long-term ETF savings plan, quarterly top-ups after tax payments.
Reply ONLY with valid JSON (no markdown) in this schema:
{
  "summary": "1-2 simple sentences about the goal and what is realistic",
  "ways": [
    {
      "title": "short action name",
      "category": "Savings | Fixed-term deposit | Money market fund | ETF savings plan | Reserve",
      "frequency": "one-off | weekly | monthly | quarterly",
      "amount_eur": 250,
      "risk": "low | medium | high",
      "return_min_pct": 1.0,
      "return_max_pct": 2.5,
      "plain_explanation": "1 sentence: what this is, for a layperson",
      "rationale": "1-2 sentences: why it fits this goal and this account"
    }
  ],
  "warnings": ["short plain warnings"]
}
Do NOT propose plain saving without a product (cash or a current account): the app already shows
"regular saving, no interest" as the standard way to beat. Every proposal must differ from it, for
example by earning interest or returns, or by being a one-off deposit.
Rules: amount_eur is the amount PER PAYMENT (for "one-off" the single deposit now). return_*_pct
is the expected ANNUAL return in %. Payments must be affordable: a regular payment must not
exceed the account's average monthly surplus (per month equivalent). Use realistic, cautious
returns and do not promise them. Use each category at most once."""


# --- Calculation ---------------------------------------------------------------------------


def _periods_for(months: int, freq: str) -> int:
    return max(math.ceil(months * PERIODS_PER_YEAR[freq] / 12), 1)


def required_payment(target: float, saved: float, months: int, freq: str, rate: float) -> float:
    """Payment needed to reach `target` after `months`, if `saved` already sits in the same vehicle."""
    if freq == "one-off":
        growth = (1 + rate / 12) ** months
        return max(target / growth - saved, 0.0)
    n = _periods_for(months, freq)
    i = rate / PERIODS_PER_YEAR[freq]
    growth = (1 + i) ** n
    need = max(target - saved * growth, 0.0)
    return need / n if i == 0 else need * i / (growth - 1)


def simulate(target: float, saved: float, payment: float, freq: str, rate: float) -> tuple[int | None, int, float, float]:
    """(months to goal or None, payments made, total paid, interest earned)."""
    if freq == "one-off":
        bal, paid, month = saved + payment, payment, 0
        i = rate / 12
        while bal < target - 0.005 and month < MAX_MONTHS:
            bal *= 1 + i
            month += 1
        if bal < target - 0.005:
            return None, 1, paid, 0.0
        return month, 1, paid, max(bal - saved - paid, 0.0)
    per_year = PERIODS_PER_YEAR[freq]
    i, bal, n, paid = rate / per_year, saved, 0, 0.0
    if payment <= 0 and (saved <= 0 or i <= 0):
        return None, 0, 0.0, 0.0
    while bal < target - 0.005 and n * 12 / per_year < MAX_MONTHS:
        bal = bal * (1 + i) + payment
        paid += payment
        n += 1
    if bal < target - 0.005:
        return None, n, paid, 0.0
    return math.ceil(n * 12 / per_year), n, paid, max(bal - saved - paid, 0.0)


def _ceil_money(v: float) -> float:
    v = max(v, 0.0)
    return math.ceil(v * 100 - 1e-9) / 100 if v < 100 else float(math.ceil(v - 1e-9))


def finalize(req: GoalPlanRequest, raw_ways: list[dict]) -> list[GoalWay]:
    ways: list[GoalWay] = []
    for n, w in enumerate(raw_ways, 1):
        freq = pick(w.get("frequency", ""), _FREQ, "monthly")
        lo, hi = num(w.get("return_min_pct")), num(w.get("return_max_pct"))
        lo, hi = max(min(lo, hi), 0), max(max(lo, hi), 0)
        rate = (lo + hi) / 2 / 100
        if req.deadline_months:
            # Round UP so the goal is really reached within the deadline.
            payment = _ceil_money(required_payment(req.target, req.saved, req.deadline_months, freq, rate))
        else:
            payment = round(max(num(w.get("amount_eur")), 0.0), 2 if num(w.get("amount_eur")) < 100 else 0)
        if req.saved >= req.target:
            months, payments, paid, interest = 0, 0, 0.0, 0.0
        else:
            months, payments, paid, interest = simulate(req.target, req.saved, payment, freq, rate)
        ways.append(GoalWay(
            id=f"way-{n}",
            title=str(w.get("title") or "Way to reach the goal")[:80],
            category=str(w.get("category") or "Savings")[:40],
            frequency=freq,
            amount_eur=payment,
            payments=payments,
            months=months,
            total_paid=round(paid, 2),
            expected_interest=round(interest, 2),
            risk=pick(w.get("risk", ""), _RISK, "low"),
            return_min_pct=lo,
            return_max_pct=hi,
            plain_explanation=str(w.get("plain_explanation", "")),
            rationale=str(w.get("rationale", "")),
        ))
    # Fastest first among those that reach the goal; unreachable ones last.
    return sorted(ways, key=lambda x: (x.months is None, x.months or 0))


def _monthly_equivalent(w: GoalWay) -> float | None:
    """What a way costs per month on average (None for a one-off deposit)."""
    per_year = PERIODS_PER_YEAR.get(w.frequency)
    return w.amount_eur * per_year / 12 if per_year else None


def compare_to_baseline(req: GoalPlanRequest, ways: list[GoalWay]) -> GoalWay:
    """The standard way: put the same monthly sum aside, with no interest.

    The sum is the typical (median) monthly amount of the proposed ways, or, with a deadline, exactly what
    is needed in time. Every way gets `months_faster` relative to saving its own monthly amount without interest.
    """
    remaining = max(req.target - req.saved, 0.0)
    if req.deadline_months:
        monthly = _ceil_money(required_payment(req.target, req.saved, req.deadline_months, "monthly", 0.0))
    else:
        amounts = sorted(a for w in ways if (a := _monthly_equivalent(w)) is not None and a > 0)
        monthly = amounts[len(amounts) // 2] if amounts else max(remaining / 24, 10.0)
    monthly = round(max(monthly, 1.0), 2 if monthly < 100 else 0)
    months = 0 if remaining <= 0 else math.ceil(remaining / monthly)
    baseline = GoalWay(
        id="baseline",
        title="Regular saving",
        category="Standard",
        frequency="monthly",
        amount_eur=monthly,
        payments=months,
        months=months,
        total_paid=round(remaining, 2),
        expected_interest=0.0,
        risk="low",
        plain_explanation="Simply move the same amount aside every month. No product, no interest.",
        rationale="This is the plain alternative every other way is compared with.",
    )
    for w in ways:
        # Like for like: saving the same monthly amount as this way, just without the product's interest.
        own = _monthly_equivalent(w)
        like_for_like = own is not None and own > 0 and remaining > 0
        own_months = math.ceil(remaining / own) if like_for_like else months
        w.months_faster = None if w.months is None else own_months - w.months
    return baseline


def drop_plain_saving(req: GoalPlanRequest, ways: list[GoalWay]) -> list[GoalWay]:
    """Remove ways that are no different from the standard way (regular saving with next to no interest).

    The standard way is already shown first, so a "savings account" that is neither faster nor earns a
    noticeable amount would only repeat it.
    """
    remaining = max(req.target - req.saved, 0.0)
    kept = [
        w for w in ways
        if w.frequency == "one-off" or w.months is None or (w.months_faster or 0) > 0
        or w.expected_interest >= 0.01 * remaining
    ]
    return kept or ways


# --- Context & demo ------------------------------------------------------------------------


def monthly_surplus(ov: AccountOverview) -> float:
    k = ov.kpis
    return max(k.avg_monthly_income - k.avg_monthly_expenses, 0.0)


def build_context(req: GoalPlanRequest, ov: AccountOverview, business: str) -> str:
    k = ov.kpis
    deadline = (
        f"The owner wants it within {req.deadline_months} months (payments are calculated by the system)."
        if req.deadline_months else "No deadline: propose payments the account can afford."
    )
    return f"""Client: {business}
Goal: "{req.name}" — target {eur(req.target)}; already saved {eur(req.saved)}. {deadline}
Current balance: {eur(ov.balance)}; lowest balance last year: {eur(k.min_balance)} ({k.overdraft_days} days overdrawn)
Average monthly income (excluding the June shutdown): {eur(k.avg_monthly_income)}
Average monthly expenses: {eur(k.avg_monthly_expenses)}
Average monthly surplus: {eur(monthly_surplus(ov))}
Annual 3-week shutdown in June: no revenue, fixed costs continue."""


def demo_ways(req: GoalPlanRequest, ov: AccountOverview) -> list[dict]:
    """Rule-based ways while the model is not connected."""
    remaining = max(req.target - req.saved, 1.0)
    affordable = max(round(monthly_surplus(ov) * 0.3, -1), 50.0)
    fair = max(round(remaining / 24, -1), 10.0)  # ~2 years
    lump = min(remaining * 0.6, max(ov.balance * 0.3, 0))
    ways = [
        {"title": "Save every month", "category": "Savings", "frequency": "monthly", "amount_eur": min(affordable, fair * 2),
         "risk": "low", "return_min_pct": 0.5, "return_max_pct": 1.5,
         "plain_explanation": "Move a fixed amount to a savings account on the same day each month.",
         "rationale": f"About {eur(affordable)} a month fits your average surplus of {eur(monthly_surplus(ov))}."},
        {"title": "Weekly top-up", "category": "Savings", "frequency": "weekly", "amount_eur": round(min(affordable, fair * 2) / 4.3, 0) or 10,
         "risk": "low", "return_min_pct": 0.5, "return_max_pct": 1.5,
         "plain_explanation": "Smaller payments each week are easier to keep up than one big one.",
         "rationale": "Regular small payments smooth out the quiet weeks, such as the June shutdown."},
        {"title": "Fixed-term deposit now", "category": "Fixed-term deposit", "frequency": "one-off", "amount_eur": round(lump, -1),
         "risk": "low", "return_min_pct": 2.0, "return_max_pct": 3.0,
         "plain_explanation": "The bank keeps a lump sum for a fixed time and pays guaranteed interest.",
         "rationale": "Good if you have spare cash today and do not need it for running costs."},
        {"title": "Money market fund, monthly", "category": "Money market fund", "frequency": "monthly", "amount_eur": fair,
         "risk": "low", "return_min_pct": 2.0, "return_max_pct": 3.0,
         "plain_explanation": "A fund that lends money for short periods. You can usually sell it quickly.",
         "rationale": "A little more interest than a savings account with similar safety."},
        {"title": "ETF savings plan", "category": "ETF savings plan", "frequency": "monthly", "amount_eur": fair,
         "risk": "medium", "return_min_pct": 3.0, "return_max_pct": 6.0,
         "plain_explanation": "Monthly purchases of a basket of shares. The value can drop for a while.",
         "rationale": "Only sensible for goals more than 3–5 years away."},
    ]
    return [w for w in ways if w["amount_eur"] > 0]


# --- Entry point ---------------------------------------------------------------------------


async def plan(
    ai: OpenShiftAIClient, req: GoalPlanRequest, ov: AccountOverview, business: str, demo_fallback: bool = False
) -> GoalPlanResponse:
    def response(source: str, summary: str, raw: list[dict], warnings: list[str] | None = None,
                 error: str | None = None) -> GoalPlanResponse:
        ways = finalize(req, raw)
        baseline = compare_to_baseline(req, ways)
        return GoalPlanResponse(
            source=source, model=ai.model, generated_at=datetime.now(timezone.utc),
            summary=summary, warnings=warnings or [], error=error,
            ways=drop_plain_saving(req, ways), baseline=baseline,
        )

    def from_model(data: dict) -> GoalPlanResponse:
        raw = [w for w in data.get("ways", []) if isinstance(w, dict)]
        if not raw:
            raise ValueError("the reply contains no ways")
        return response("openshift-ai", str(data.get("summary", "")), raw,
                        [str(x) for x in data.get("warnings", [])])

    try:
        return await run_agent(ai, "goals", SYSTEM_PROMPT, build_context(req, ov, business), from_model)
    except AgentUnavailable as exc:
        if demo_fallback:
            return response("demo", f"Ways to reach “{req.name}” based on your average monthly surplus.",
                            demo_ways(req, ov), error=str(exc))
        return GoalPlanResponse(source="unavailable", model=ai.model, generated_at=datetime.now(timezone.utc),
                                ways=[], error=str(exc))


def build_goals(defs: list[GoalDefinition]) -> list[Goal]:
    out = []
    for d in defs:
        remaining = max(d.target - d.saved, 0.0)
        out.append(Goal(**d.model_dump(), remaining=round(remaining, 2),
                        percent=round(min(d.saved / d.target * 100, 100), 1)))
    return out



def goal_flows(defs: list[GoalDefinition], as_of: date, days: int) -> dict[date, list[tuple[str, float]]]:
    """Payments into the goals' chosen ways, day by day, starting the day after `as_of`.

    weekly = every 7 days, monthly = on the 1st, quarterly = on the 1st of Jan/Apr/Jul/Oct,
    one-off = on the first day. Each way stops after its number of payments.
    """
    out: dict[date, list[tuple[str, float]]] = {}
    for g in defs:
        w = g.way
        if not w or w.amount_eur <= 0 or w.payments <= 0 or g.saved >= g.target:
            continue
        made = 0
        for k in range(1, days + 1):
            if made >= w.payments:
                break
            day = as_of + timedelta(days=k)
            due = (
                k == 1 if w.frequency == "one-off"
                else (k - 1) % 7 == 0 if w.frequency == "weekly"
                else day.day == 1 if w.frequency == "monthly"
                else day.day == 1 and day.month in (1, 4, 7, 10)
            )
            if due:
                out.setdefault(day, []).append((f"Goal: {g.name}", w.amount_eur))
                made += 1
    return out
