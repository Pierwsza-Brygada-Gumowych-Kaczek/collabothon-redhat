"""Tax agent: coordinates advance tax payments and identifies optimisation opportunities.

Scenario: sole proprietorship (Einzelunternehmen) in Frankfurt am Main, so German taxes apply:
income tax (Einkommensteuer), trade tax (Gewerbesteuer), wage tax for employees (Lohnsteuer).

The statement does not show everything (depreciation, cash, VAT, private deductions),
so all amounts are indicative estimates.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.schemas import TaxFacts, TaxPayment, TaxTip, TaxTipsResponse
from app.services.agent_base import AgentUnavailable, eur, num, pick, run_agent, str_list
from app.services import demo
from app.services.openshift_ai import OpenShiftAIClient
from app.services.statement import CAT_SWISS, Transaction

PREPAYMENT_BASIS = 30_000.0  # prior-year profit used by the tax office (scenario sheet)
TRADE_TAX_ALLOWANCE = 24_500.0  # Freibetrag for sole proprietors (§11 GewStG)
TRADE_TAX_BASE_RATE = 0.035  # Steuermesszahl
TRADE_TAX_MULTIPLIER = 4.60  # Frankfurt am Main Hebesatz 460%
TRADE_TAX_CREDIT_FACTOR = 4.0  # §35 EStG credit against income tax

# Quarterly due dates (month, day) from the scenario sheet.
INCOME_TAX_DUE = [(3, 10), (6, 10), (9, 10), (12, 10)]
TRADE_TAX_DUE = [(2, 15), (5, 15), (8, 15), (11, 15)]


def income_tax_2025(zve: float) -> float:
    """Basic tariff §32a EStG 2025 (single filer), without solidarity surcharge."""
    x = float(int(max(zve, 0)))
    if x <= 12_096:
        return 0.0
    if x <= 17_443:
        y = (x - 12_096) / 10_000
        return (932.30 * y + 1_400) * y
    if x <= 68_480:
        z = (x - 17_443) / 10_000
        return (176.64 * z + 2_397) * z + 1_015.13
    if x <= 277_825:
        return 0.42 * x - 10_911.92
    return 0.45 * x - 19_246.67


def solidarity_surcharge(tax: float) -> float:
    """Soli 2025: exempt up to €19,950 of income tax, then phase-in zone, max 5.5%."""
    if tax <= 19_950:
        return 0.0
    return min(0.055 * tax, 0.119 * (tax - 19_950))


def tax_burden(profit: float) -> tuple[float, float]:
    """(income tax + soli after §35 credit, trade tax) for a given profit."""
    base = max(int((profit - TRADE_TAX_ALLOWANCE) / 100) * 100, 0)
    messbetrag = base * TRADE_TAX_BASE_RATE
    trade = messbetrag * TRADE_TAX_MULTIPLIER
    credit = min(TRADE_TAX_CREDIT_FACTOR * messbetrag, trade)
    est = max(income_tax_2025(profit) - credit, 0)
    return est + solidarity_surcharge(est), trade


def build_facts(txs: tuple[Transaction, ...]) -> TaxFacts:
    revenue = expenses = owner = est_paid = trade_paid = wage = social = 0.0
    vat = False
    for t in txs:
        ref, a = t.reference, t.amount_eur
        if a > 0:
            revenue += a
        elif "Owner Salary" in ref:
            owner += -a  # owner's withdrawal — not a business expense
        elif t.category == CAT_SWISS:
            pass  # capital investment — not an expense
        elif "Income Tax Prepayment" in ref:
            est_paid += -a  # owner's personal income tax — not an expense
        elif "Trade Tax" in ref:
            trade_paid += -a  # trade tax is not deductible (§4(5b) EStG)
        else:
            if "Wage Tax" in ref:
                wage += -a
            elif "Social Security" in ref:
                social += -a
            expenses += -a
        if "VAT" in ref.upper() or "UMSATZSTEUER" in ref.upper():
            vat = True

    profit = revenue - expenses
    income_tax, trade_tax = tax_burden(profit)
    hi_income, hi_trade = tax_burden(profit + 1_000)
    marginal = (hi_income + hi_trade - income_tax - trade_tax) / 1_000
    additional = max(income_tax - est_paid, 0) + max(trade_tax - trade_paid, 0)
    return TaxFacts(
        year=txs[-1].booking_date.year,
        revenue=round(revenue, 2),
        business_expenses=round(expenses, 2),
        estimated_profit=round(profit, 2),
        prepayment_basis=PREPAYMENT_BASIS,
        income_tax_prepaid=round(est_paid, 2),
        trade_tax_prepaid=round(trade_paid, 2),
        wage_tax_paid=round(wage, 2),
        social_security_paid=round(social, 2),
        owner_withdrawals=round(owner, 2),
        estimated_income_tax=round(income_tax, 2),
        estimated_trade_tax=round(trade_tax, 2),
        estimated_additional_payment=round(additional, 2),
        marginal_rate_pct=round(marginal * 100, 1),
        vat_payments_found=vat,
        recommended_quarterly_prepayment=round(income_tax / 4, -1),
        monthly_tax_reserve=round(additional / 6, -1),
    )


def build_schedule(txs: tuple[Transaction, ...], f: TaxFacts, months: int = 12) -> list[TaxPayment]:
    """Advance tax payments for the next `months` months after the statement ends."""
    last = txs[-1].booking_date
    wage_monthly = f.wage_tax_paid / 12
    est_now = f.income_tax_prepaid / 4
    trade_now = f.trade_tax_prepaid / 4
    out: list[TaxPayment] = []
    for i in range(1, months + 1):
        y, m = last.year + (last.month - 1 + i) // 12, (last.month - 1 + i) % 12 + 1
        out.append(TaxPayment(date=date(y, m, 10), tax="Wage tax (employees)",
                              current_amount=round(wage_monthly, 2), recommended_amount=round(wage_monthly, 2),
                              note="Withheld from salaries — no change needed."))
        if (m, 10) in INCOME_TAX_DUE:
            out.append(TaxPayment(date=date(y, m, 10), tax="Income tax prepayment",
                                  current_amount=round(est_now, 2),
                                  recommended_amount=f.recommended_quarterly_prepayment,
                                  note="Ask the tax office to raise it to match the real profit."))
        if (m, 15) in TRADE_TAX_DUE:
            out.append(TaxPayment(date=date(y, m, 15), tax="Trade tax prepayment",
                                  current_amount=round(trade_now, 2),
                                  recommended_amount=round(f.estimated_trade_tax / 4, -1),
                                  note="Set by the city of Frankfurt; expect an adjustment notice."))
    return sorted(out, key=lambda p: p.date)


SYSTEM_PROMPT = """You are the tax agent of a bank's AI CFO. The client is a sole proprietorship
(restaurant) in Frankfurt am Main, Germany. Based on the account data you
(1) coordinate advance tax payments (are the prepayments right? how much to reserve?) and
(2) list LEGAL ways to reduce taxes (income tax, trade tax, payroll costs), plus warnings.
Do not invent laws; if unsure, leave the tip out. Savings are a cautious estimate at the given
marginal rate.
Reply ONLY with valid JSON (no markdown) in this schema:
{
  "summary": "2-3 simple sentences on the tax situation and what to do about prepayments",
  "tips": [
    {
      "title": "short tip name",
      "category": "Investment | Pension | Employees | Purchases | Legal form | Prepayments | Other",
      "saving_min_eur": 1000,
      "saving_max_eur": 2000,
      "difficulty": "easy | medium | hard",
      "when": "deadline / when to act",
      "plain_explanation": "1-2 sentences, what it is",
      "steps": ["step 1", "step 2"],
      "rationale": "why it fits this data",
      "legal_basis": "e.g. Income Tax Act §7g"
    }
  ],
  "warnings": ["important tax risks visible in the data"]
}
Give 4-6 tips, biggest saving first."""


def build_context(f: TaxFacts, schedule: list[TaxPayment]) -> str:
    upcoming = "\n".join(
        f"- {p.date}: {p.tax} — current {eur(p.current_amount)}, recommended {eur(p.recommended_amount)}"
        for p in schedule if p.tax != "Wage tax (employees)"
    )
    return f"""Year: {f.year}
Revenue on the account: {eur(f.revenue)}
Business expenses (excluding owner withdrawals, income tax, trade tax, the Swiss investment): {eur(f.business_expenses)}
Estimated profit: {eur(f.estimated_profit)}
Income tax prepayments were set on a profit of {eur(f.prepayment_basis)}; paid {eur(f.income_tax_prepaid)}
Trade tax prepayments paid: {eur(f.trade_tax_prepaid)}
Estimated income tax + solidarity surcharge (single filer, after trade tax credit): {eur(f.estimated_income_tax)}
Estimated trade tax (Frankfurt, municipal multiplier 460%): {eur(f.estimated_trade_tax)}
Estimated back-payment for the year: {eur(f.estimated_additional_payment)}
Marginal tax rate: about {f.marginal_rate_pct}%
Net wages of 3 employees: €64,800/year; wage tax: {eur(f.wage_tax_paid)}; social security: {eur(f.social_security_paid)}
Owner withdrawals: {eur(f.owner_withdrawals)} (€3,200/month)
Silent partnership in the brother's restaurant in Zurich: CHF 50,000 paid in 2025
VAT payments in the statement: {"yes" if f.vat_payments_found else "NONE"}
Not in the statement: equipment purchases, private pension, employee benefits.
Upcoming prepayments:
{upcoming}"""
 


_DIFF = {"easy": "easy", "medium": "medium", "hard": "hard"}


def _normalize(t: dict) -> dict:
    lo, hi = max(num(t.get("saving_min_eur")), 0), max(num(t.get("saving_max_eur")), 0)
    t["saving_min_eur"], t["saving_max_eur"] = min(lo, hi), max(lo, hi)
    t["difficulty"] = pick(t.get("difficulty", ""), _DIFF, "medium")
    t["steps"] = str_list(t.get("steps", []))
    return t


async def generate(
    ai: OpenShiftAIClient, txs: tuple[Transaction, ...], demo_fallback: bool = False
) -> TaxTipsResponse:
    """Facts and the prepayment schedule are calculated; the tips come from the model only."""
    f = build_facts(txs)
    schedule = build_schedule(txs, f)

    def from_model(data: dict) -> TaxTipsResponse:
        tips = [TaxTip(**_normalize(t)) for t in data.get("tips", []) if isinstance(t, dict)]
        if not tips:
            raise ValueError("the reply contains no tips")
        return TaxTipsResponse(
            source="openshift-ai",
            model=ai.model,
            generated_at=datetime.now(timezone.utc),
            summary=str(data.get("summary", "")),
            facts=f,
            schedule=schedule,
            tips=tips,
            warnings=[str(w) for w in data.get("warnings", [])],
        )

    try:
        return await run_agent(ai, "tax", SYSTEM_PROMPT, build_context(f, schedule), from_model, 2000)
    except AgentUnavailable as exc:
        if demo_fallback:
            return demo.tax(f, schedule).model_copy(update={"error": str(exc)})
        return TaxTipsResponse(source="unavailable", model=ai.model, generated_at=datetime.now(timezone.utc),
                               facts=f, schedule=schedule, tips=[], error=str(exc))
