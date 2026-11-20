"""FX hedging agent: identifies currency risks from foreign-currency payments and structures
hedges using Commerzbank FX products.

In the sample data the foreign-currency flows are the CHF instalments to the silent
partnership in Zurich (12 × CHF 4,166.67). The agent measures how much the exchange rate moved,
what that cost, and what open CHF exposure remains (the CHF 50,000 stake and its future
profit distributions).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from app.schemas import FxExposure, FxPayment, FxResponse, HedgeProposal
from app.services.agent_base import AgentUnavailable, eur, num, pick, run_agent, str_list
from app.services import demo
from app.services.openshift_ai import OpenShiftAIClient
from app.services.statement import Transaction


def build_exposures(txs: tuple[Transaction, ...]) -> list[FxExposure]:
    groups: dict[tuple[str, str], list[Transaction]] = defaultdict(list)
    for t in txs:
        if t.currency != "EUR" and t.fx_rate:
            groups[(t.currency, t.counterparty)].append(t)

    out = []
    for (ccy, cp), items in groups.items():
        items.sort(key=lambda t: t.booking_date)
        total_foreign = -sum(t.amount for t in items)
        total_eur = -sum(t.amount_eur for t in items)
        rates = [t.fx_rate for t in items if t.fx_rate]
        rmin, rmax = min(rates), max(rates)
        out.append(FxExposure(
            currency=ccy,
            counterparty=cp,
            payments=[FxPayment(date=t.booking_date, amount=-t.amount, currency=ccy, rate=t.fx_rate or 0,
                                amount_eur=-t.amount_eur) for t in items],
            total_foreign=round(total_foreign, 2),
            total_eur=round(total_eur, 2),
            rate_min=rmin,
            rate_max=rmax,
            rate_avg=round(total_eur / total_foreign, 4) if total_foreign else 0,
            rate_swing_pct=round((rmax - rmin) / rmin * 100, 2),
            extra_cost_vs_best_rate=round(total_eur - total_foreign * rmin, 2),
            cost_with_forward_at_first_rate=round(total_foreign * rates[0], 2),
            open_position_foreign=round(total_foreign, 2),
            open_position_note=(
                f"All payments are done, but you now own a {ccy} {total_foreign:,.0f} stake in Zurich. "
                f"Its value and any profit distributions are paid in {ccy}, so a weaker {ccy} would "
                "reduce what you get back in euros."
            ),
        ))
    return out


SYSTEM_PROMPT = """You are the FX hedging agent of Commerzbank's AI CFO for small businesses.
You get the client's foreign-currency payments (amounts, dates, exchange rates) and the
remaining open currency position. Identify the currency risk in plain words and structure
hedges using standard Commerzbank FX products: FX forward, FX option, FX swap, and a
foreign-currency account. Size hedges to the actual exposure
(typically 50-100% of known flows). Never claim a hedge makes money; it removes uncertainty.
Reply ONLY with valid JSON (no markdown) in this schema:
{
  "summary": "2-3 simple sentences on the currency risk",
  "risk_level": "low | medium | high",
  "hedges": [
    {
      "title": "short name",
      "product": "Commerzbank product name",
      "notional": 25000,
      "currency": "CHF",
      "tenor": "e.g. 3-12 months",
      "protects_against": "what risk it removes",
      "cost": "plain description of the cost (premium, spread, none)",
      "plain_explanation": "1-2 sentences for a layperson",
      "rationale": "why, based on the data",
      "steps": ["step 1", "step 2"]
    }
  ],
  "warnings": ["short plain warnings"]
}
Give 2-4 hedges, most relevant first."""


def build_context(exps: list[FxExposure]) -> str:
    parts = []
    for e in exps:
        pay = "\n".join(f"  - {p.date}: {p.currency} {p.amount:,.2f} @ {p.rate} EUR/{p.currency} = {eur(p.amount_eur)}"
                        for p in e.payments)
        parts.append(f"""Exposure: {e.currency} payments to {e.counterparty}
Total paid: {e.currency} {e.total_foreign:,.2f} = {eur(e.total_eur)}
Rate range: {e.rate_min}–{e.rate_max} EUR/{e.currency} (swing {e.rate_swing_pct}%), average {e.rate_avg}
Extra cost versus the best rate of the year: {eur(e.extra_cost_vs_best_rate)}
Cost if all payments had been locked at the first payment's rate (forward): {eur(e.cost_with_forward_at_first_rate)}
Open position: {e.open_position_note}
Payments:
{pay}""")
    return "\n\n".join(parts) or "No foreign-currency payments."


async def generate(
    ai: OpenShiftAIClient, txs: tuple[Transaction, ...], demo_fallback: bool = False
) -> FxResponse:
    """Exposures are calculated; the risk rating and hedges come from the model only."""
    exps = build_exposures(txs)

    def from_model(data: dict) -> FxResponse:
        hedges = []
        for h in data.get("hedges", []):
            if isinstance(h, dict):
                h.update(notional=max(num(h.get("notional")), 0), steps=str_list(h.get("steps", [])))
                hedges.append(HedgeProposal(**h))
        if exps and not hedges:
            raise ValueError("the reply contains no hedges")
        return FxResponse(
            source="openshift-ai",
            model=ai.model,
            generated_at=datetime.now(timezone.utc),
            summary=str(data.get("summary", "")),
            exposures=exps,
            risk_level=pick(data.get("risk_level", ""), {"low": "low", "medium": "medium", "high": "high"}, "medium"),
            hedges=hedges,
            warnings=[str(w) for w in data.get("warnings", [])],
        )

    try:
        return await run_agent(ai, "fx", SYSTEM_PROMPT, build_context(exps), from_model)
    except AgentUnavailable as exc:
        if demo_fallback:
            return demo.fx(exps).model_copy(update={"error": str(exc)})
        return FxResponse(source="unavailable", model=ai.model, generated_at=datetime.now(timezone.utc),
                          exposures=exps, hedges=[], error=str(exc))
