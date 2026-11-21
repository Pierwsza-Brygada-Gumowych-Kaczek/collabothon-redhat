"""Investment agent: analyses available liquidity and recommends investments
(fixed-term deposits, money market funds, ETFs) and capex financing."""

from __future__ import annotations

from datetime import datetime, timezone

from app.schemas import AccountOverview, InsightsResponse, InvestmentProposal
from app.services.agent_base import AgentUnavailable, eur, num, pick, run_agent
from app.services import demo
from app.services.openshift_ai import OpenShiftAIClient

SYSTEM_PROMPT = """You are the investment agent of a bank's AI CFO for small businesses.
You analyse the cash flows of the client's business account and recommend what to do with
available liquidity: fixed-term deposits, money market funds, long-term
savings (ETF) and CAPEX FINANCING (e.g. an investment loan or leasing for equipment instead of
paying cash). Consider seasonality, fixed costs, taxes and keep a safety buffer in mind when sizing amounts.
NEVER propose the safety buffer / liquidity reserve itself as an investment (no "Reserve", "safety buffer" or
"emergency fund" proposals): it is not an investment, only a limit on how much can be invested.
Reply ONLY with valid JSON (no markdown) in this schema:
{
  "summary": "2-3 simple sentences on the financial situation",
  "proposals": [
    {
      "title": "short action name",
      "kind": "investment | financing",
      "category": "Fixed-term deposit | Money market fund | ETF | Capex financing",
      "amount_eur": 10000,
      "contribution": "one-off | monthly",
      "horizon_months": 6,
      "risk": "low | medium | high",
      "return_min_pct": 2.0,
      "return_max_pct": 3.0,
      "plain_explanation": "1 sentence: what this product is, for a layperson",
      "rationale": "1-2 sentences: why it makes sense given the data"
    }
  ],
  "warnings": ["short plain warnings"]
}
Rules: return_*_pct is the ANNUAL return in % for investments, and the ANNUAL interest rate
in % for financing. horizon_months is a number of months (for financing: loan term).
Give 4-5 proposals, safest first, and include exactly one capex financing proposal.
One-off investment amounts must not exceed the surplus above the safety buffer."""


def build_context(ov: AccountOverview, business: str) -> str:
    k = ov.kpis
    months = "\n".join(
        f"- {m.month}: income {eur(m.income)}, expenses {eur(m.expenses)}, "
        f"end balance {eur(m.end_balance)}"
        for m in ov.monthly
    )
    cats = "\n".join(f"- {c.name}: {eur(c.amount)}" for c in ov.categories)
    return f"""Client: {business}
Period: {ov.period_from} – {ov.period_to}
Opening balance: {eur(ov.opening_balance)}; current balance: {eur(ov.balance)}
Total income: {eur(k.total_income)}; total expenses: {eur(k.total_expenses)}
Lowest balance: {eur(k.min_balance)} ({k.min_balance_date}); days in overdraft: {k.overdraft_days}
Average monthly income (excluding the June shutdown): {eur(k.avg_monthly_income)}
Average monthly expenses: {eur(k.avg_monthly_expenses)}
Transfers to Switzerland (silent partnership in the owner's brother's restaurant in Zurich,
CHF 50,000 in 12 instalments): {k.swiss_transfers_count} instalments, total {eur(k.swiss_transfers_eur)}
— the last one was in December, so from January this outflow stops.
Annual 3-week shutdown in June: no revenue, fixed costs continue.
No equipment purchases in the statement (kitchen equipment is likely ageing).

Monthly:
{months}

Totals by category (negative = expenses):
{cats}"""


_RISK = {"low": "low", "medium": "medium", "high": "high"}


def is_buffer(p: InvestmentProposal) -> bool:
    """The safety buffer is a limit on investing, never an investment option itself."""
    text = f"{p.category} {p.title}".lower()
    return any(w in text for w in ("reserve", "buffer", "emergency fund"))


def _normalize(p: dict) -> dict:
    p["kind"] = "financing" if str(p.get("kind", "")).lower().startswith("fin") else "investment"
    p["risk"] = pick(p.get("risk", ""), _RISK, "medium")
    p["amount_eur"] = max(num(p.get("amount_eur")), 0)
    p["horizon_months"] = min(max(int(num(p.get("horizon_months"), 12)), 1), 600)
    lo, hi = num(p.get("return_min_pct")), num(p.get("return_max_pct"))
    p["return_min_pct"], p["return_max_pct"] = min(lo, hi), max(lo, hi)
    p["contribution"] = "monthly" if str(p.get("contribution", "")).lower().startswith("month") else "one-off"
    return p


async def generate(
    ai: OpenShiftAIClient, ov: AccountOverview, business: str, demo_fallback: bool = False
) -> InsightsResponse:
    """All proposals come from the model; without it the response carries only an error."""

    def from_model(data: dict) -> InsightsResponse:
        proposals = [InvestmentProposal(**_normalize(p)) for p in data.get("proposals", []) if isinstance(p, dict)]
        proposals = [p for p in proposals if not is_buffer(p)]
        if not proposals:
            raise ValueError("the reply contains no proposals")
        return InsightsResponse(
            source="openshift-ai",
            model=ai.model,
            generated_at=datetime.now(timezone.utc),
            summary=str(data.get("summary", "")),
            proposals=proposals,
            warnings=[str(w) for w in data.get("warnings", [])],
        )

    try:
        return await run_agent(ai, "investment", SYSTEM_PROMPT, build_context(ov, business), from_model)
    except AgentUnavailable as exc:
        if demo_fallback:
            return demo.insights(ov).model_copy(update={"error": str(exc)})
        return InsightsResponse(source="unavailable", model=ai.model, generated_at=datetime.now(timezone.utc),
                                proposals=[], error=str(exc))
