"""Demo recommendations used ONLY while the OpenShift AI model is not connected.

Switched on with AGENTS_DEMO_FALLBACK=true (default for now). They are rule-based texts filled
with the real figures from the bank statement, returned with `source: "demo"` so the UI labels
them clearly. Set AGENTS_DEMO_FALLBACK=false once the model is connected: the agents then show
an error instead of demo content when the model fails.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

from app.schemas import (
    AccountOverview,
    CreditFacility,
    FxExposure,
    FxResponse,
    HedgeProposal,
    InsightsResponse,
    InvestmentProposal,
    LiquidityResponse,
    TaxFacts,
    TaxPayment,
    TaxTip,
    TaxTipsResponse,
)
from app.services.agent_base import eur, worthwhile

ARRANGED_LINE_RATE = (0.08, 0.11)  # indicative arranged credit line rate range
WORKING_CAPITAL_RATE = (0.06, 0.08)  # indicative short-term loan rate range


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- Investment agent -------------------------------------------------------------------------


def insights(ov: AccountOverview) -> InsightsResponse:
    k = ov.kpis
    # Buffer: cover the June dip, but not more than half the balance
    # (next year's dip will be shallower because the Swiss instalments have ended).
    buffer = round(min(abs(min(k.min_balance, 0)), ov.balance * 0.5), -2)
    surplus = max(ov.balance - buffer, 0)
    swiss_monthly = k.swiss_transfers_eur / max(k.swiss_transfers_count, 1)

    proposals = [
        InvestmentProposal(
            title="Set money aside for the June shutdown",
            category="Reserve",
            amount_eur=buffer,
            horizon_months=6,
            risk="low",
            return_min_pct=1.5,
            return_max_pct=2.5,
            plain_explanation="A separate savings account. Your money is safe and you can withdraw it any time.",
            rationale=(
                f"In 2025 the account fell to {eur(k.min_balance)} after the June closure and stayed "
                f"negative for {k.overdraft_days} days. This reserve avoids that."
            ),
        ),
        InvestmentProposal(
            title="Fixed-term deposit for the surplus",
            category="Fixed-term deposit",
            amount_eur=round(surplus * 0.6, -2),
            horizon_months=6,
            risk="low",
            return_min_pct=2.0,
            return_max_pct=3.0,
            plain_explanation="The bank keeps your money for a fixed time and pays interest. The amount is guaranteed.",
            rationale="At year end you hold more cash than you need for running costs.",
        ),
        InvestmentProposal(
            title="Money market fund for taxes and surprises",
            category="Money market fund",
            amount_eur=round(surplus * 0.4, -2),
            horizon_months=3,
            risk="low",
            return_min_pct=2.0,
            return_max_pct=3.0,
            plain_explanation=(
                "A very cautious fund. It earns about as much as a deposit, but you can get your "
                "money back within 1–2 days without losing interest."
            ),
            rationale="You pay tax prepayments every quarter — this money must be quickly available.",
        ),
        InvestmentProposal(
            title="Finance a new pizza oven instead of paying cash",
            kind="financing",
            category="Capex financing",
            amount_eur=25_000,
            horizon_months=60,
            risk="low",
            return_min_pct=4.5,
            return_max_pct=6.5,
            plain_explanation=(
                "An investment loan (or leasing) spreads the price of equipment over 5 years. "
                "Your cash stays available for the slow months."
            ),
            rationale=(
                "There were no equipment purchases in 2025 and your cash buffer is thin in summer. "
                "Combined with the tax agent's investment-deduction tip, the purchase also lowers your tax."
            ),
        ),
        InvestmentProposal(
            title="Monthly savings once the Swiss instalments end",
            category="ETF",
            amount_eur=round(swiss_monthly / 2, -1),
            contribution="monthly",
            horizon_months=60,
            risk="medium",
            return_min_pct=4.0,
            return_max_pct=7.0,
            plain_explanation=(
                "A fund that buys shares of hundreds of large companies at once. Its value moves "
                "up and down, but over long periods it has usually grown."
            ),
            rationale=(
                f"From January you no longer pay about {eur(swiss_monthly)} a month to Zurich. "
                "Half of it can go into long-term savings, half into the reserve."
            ),
        ),
    ]
    return InsightsResponse(
        source="demo",
        generated_at=_now(),
        summary=(
            f"The year ended with {eur(ov.balance)} in the account, although it fell to "
            f"{eur(k.min_balance)} in July. The Zurich instalments are fully paid, so from January "
            "more cash stays in the business every month."
        ),
        proposals=proposals,
        warnings=[
            "When the restaurant closes in June the account quickly goes negative — build the reserve before May.",
            "At the start of each quarter tax prepayments coincide with rent — you need more cash then.",
        ],
    )


# --- Tax agent --------------------------------------------------------------------------------


def tax(f: TaxFacts, schedule: list[TaxPayment]) -> TaxTipsResponse:
    r = f.marginal_rate_pct / 100

    def save(lo: float, hi: float) -> dict:
        return {"saving_min_eur": round(lo * r, -1), "saving_max_eur": round(hi * r, -1)}

    tips = [
        TaxTip(
            title="Raise your prepayments now and avoid one big bill",
            category="Prepayments",
            saving_min_eur=0,
            saving_max_eur=round(f.estimated_additional_payment * 0.02, -1),
            difficulty="easy",
            when="before the next quarterly due date",
            plain_explanation=(
                "Ask the tax office to adjust your prepayments to the real profit. You pay the same "
                "tax, but spread over the year instead of in one go."
            ),
            steps=[
                f"Ask your tax adviser to apply for prepayments of about {eur(f.recommended_quarterly_prepayment)} per quarter.",
                f"Until then, move about {eur(f.monthly_tax_reserve)} a month into a tax reserve.",
                "Keep the reserve in a money market fund so it still earns interest.",
            ],
            rationale=(
                f"Prepayments are based on {eur(f.prepayment_basis)} profit, but this year's profit is "
                f"about {eur(f.estimated_profit)}. Paying earlier also avoids possible late-payment interest."
            ),
            legal_basis="Income Tax Act §37; Fiscal Code §233a",
        ),
        TaxTip(
            title="Deduct a planned equipment purchase in advance",
            category="Investment",
            **save(7_500, 15_000),
            difficulty="medium",
            when="in the tax return for the year before the purchase (buy within 3 years)",
            plain_explanation=(
                "If you plan to buy e.g. a new pizza oven, you can deduct up to 50% of its price from "
                "this year's profit (investment deduction). You pay the tax later, keeping cash now."
            ),
            steps=[
                "Decide what you will buy within 3 years and roughly for how much (e.g. oven €15–30k).",
                "Your tax adviser enters the deduction in the tax return.",
                "Buy within 3 years — otherwise the deduction is reversed with interest.",
            ],
            rationale=(
                f"Your estimated profit {eur(f.estimated_profit)} is below the €200,000 limit and there "
                "are no equipment purchases in the statement. Works well with the investment agent's "
                "capex financing proposal."
            ),
            legal_basis="Income Tax Act §7g",
        ),
        TaxTip(
            title="Private pension with tax relief",
            category="Pension",
            **save(6_000, 12_000),
            difficulty="easy",
            when="pay in by 31 December",
            plain_explanation=(
                "Contributions to a basic state-certified pension plan (Rürup pension) are deductible "
                "from income — in 2025 up to about €29,000 a year. You save for retirement and pay less tax."
            ),
            steps=[
                "Choose a Rürup pension contract (bank or insurer).",
                "Set a yearly contribution, e.g. €6–12k.",
                "Give the contribution certificate to your tax adviser.",
            ],
            rationale=(
                f"You withdraw {eur(f.owner_withdrawals)} a year and there are no pension payments in the "
                f"statement. At about {f.marginal_rate_pct:.0f}% every €1,000 paid in saves about {eur(1000 * r)}."
            ),
            legal_basis="Income Tax Act §10(1) no. 2b",
        ),
        TaxTip(
            title="€50 monthly voucher for staff instead of a raise",
            category="Employees",
            saving_min_eur=1_000,
            saving_max_eur=1_800,
            difficulty="easy",
            when="from next month",
            plain_explanation=(
                "A gift card or voucher of up to €50 per employee per month is free of tax and social "
                "security (non-cash benefit). The employee gets the full €50 at no extra cost to you."
            ),
            steps=[
                "Pick a benefit-card provider.",
                "Give the voucher to your 3 employees instead of part of a raise.",
                "Stay within €50 per person per month.",
            ],
            rationale=(
                f"You employ 3 people (€64,800 net a year, {eur(f.wage_tax_paid + f.social_security_paid)} "
                "in taxes and contributions). The same benefit as a raise would cost almost twice as much."
            ),
            legal_basis="Income Tax Act §8(2)",
        ),
        TaxTip(
            title="Expense small equipment up to €800 immediately",
            category="Purchases",
            **save(2_000, 4_000),
            difficulty="easy",
            when="buy before year end",
            plain_explanation=(
                "Equipment costing up to €800 net per item (e.g. an ordering tablet, mixer, chairs) is "
                "fully deductible in the year of purchase (low-value assets)."
            ),
            steps=["List the small equipment you need.", "Buy on the business, each item ≤ €800 net, keep invoices."],
            rationale="Profit is high this year — an earlier expense lowers tax exactly now.",
            legal_basis="Income Tax Act §6(2)",
        ),
        TaxTip(
            title="Check whether a limited company pays off",
            category="Legal form",
            **save(5_000, 15_000),
            difficulty="hard",
            when="when planning next year",
            plain_explanation=(
                "With profits above roughly €100k a limited company is often cheaper: profit kept in the "
                "company is taxed at about 30% instead of your personal rate."
            ),
            steps=[
                "Ask a tax adviser to compare both forms with your numbers.",
                "Include the cost of setting up and running a limited company.",
            ],
            rationale=(
                f"Estimated profit {eur(f.estimated_profit)} at about {f.marginal_rate_pct:.0f}% — part of "
                "the profit stays in the business anyway (e.g. for investments)."
            ),
            legal_basis="Corporate Tax Act; Trade Tax Act",
        ),
    ]

    warnings = [
        f"Prepayments were based on a profit of {eur(f.prepayment_basis)}, but {f.year} profit is about "
        f"{eur(f.estimated_profit)}. Expect a back-payment of about {eur(f.estimated_additional_payment)} "
        "and higher prepayments next year.",
        "Silent partnership in Switzerland: tell your tax adviser — profits and possible losses have tax "
        "consequences (Germany–Switzerland double taxation treaty).",
    ]
    if not f.vat_payments_found:
        warnings.insert(
            1,
            "No VAT payments are visible in the statement. A restaurant usually pays VAT monthly — "
            "check with your accountant whether it is paid from another account.",
        )

    return TaxTipsResponse(
        source="demo",
        generated_at=_now(),
        summary=(
            f"The business earned about {eur(f.estimated_profit)} in {f.year} — far more than the "
            f"{eur(f.prepayment_basis)} your prepayments are based on. Priority now: reserve cash for the "
            "back-payment, raise prepayments, and legally lower profit via investments and a pension."
        ),
        facts=f,
        schedule=schedule,
        tips=sorted(worthwhile(tips), key=lambda t: -t.saving_max_eur),
        warnings=warnings,
    )


# --- Liquidity agent --------------------------------------------------------------------------


def _facility_cost(limit: float, rate: float, months: float, utilisation: float = 0.5) -> float:
    return round(limit * utilisation * rate * months / 12, -1)


def liquidity(base: LiquidityResponse, last_year_min: float, tax_facts: TaxFacts | None) -> LiquidityResponse:
    res = base.model_copy(deep=True)
    facilities: list[CreditFacility] = []
    gap = max(-res.min_balance, 0)
    seasonal = max(-last_year_min, 0)
    need = max(gap, seasonal * 0.6)  # Swiss instalments no longer deepen the June dip
    if need > 0:
        limit = math.ceil(need * 1.2 / 5_000) * 5_000
        lo, hi = ARRANGED_LINE_RATE
        facilities.append(CreditFacility(
            title="Arranged credit line for the summer dip",
            product="Commerzbank business credit line",
            limit_eur=limit,
            term="12 months, renewable",
            interest_min_pct=lo * 100,
            interest_max_pct=hi * 100,
            est_cost_eur=_facility_cost(limit, (lo + hi) / 2, 3),
            plain_explanation=(
                "A pre-agreed limit on your business account. You only pay interest on the amount "
                "you actually use, and it is cheaper than going into an unarranged overdraft."
            ),
            rationale=(
                f"Last year the account fell to {eur(last_year_min)}; an unarranged overdraft would "
                f"have cost about {eur(res.overdraft_cost_last_year)} in interest. "
                + (f"The forecast shows a low of {eur(res.min_balance)} on {res.min_balance_date:%d %b %Y}."
                   if gap else "The current forecast stays positive, so keep it as a safety net.")
            ),
            steps=[
                "Apply for the line now, while the account is healthy — approval is easier.",
                "Use it only in May–August if needed and repay from autumn revenue.",
            ],
        ))
    if tax_facts and tax_facts.estimated_additional_payment > res.opening_balance * 0.5:
        amount = math.ceil(tax_facts.estimated_additional_payment * 0.5 / 5_000) * 5_000
        lo, hi = WORKING_CAPITAL_RATE
        facilities.append(CreditFacility(
            title="Bridge loan for the tax back-payment",
            product="Commerzbank short-term working-capital loan",
            limit_eur=amount,
            term="6–9 months",
            interest_min_pct=lo * 100,
            interest_max_pct=hi * 100,
            est_cost_eur=_facility_cost(amount, (lo + hi) / 2, 7.5, utilisation=0.6),
            plain_explanation=(
                "A short loan with fixed instalments that covers a one-off bill, so your day-to-day "
                "cash is not used up at once."
            ),
            rationale=(
                f"The tax agent expects a back-payment of about {eur(tax_facts.estimated_additional_payment)}, "
                f"while the account holds {eur(res.opening_balance)} and the June shutdown follows."
            ),
            steps=[
                "Wait for the tax assessment notice to know the exact amount and due date.",
                "Pay part from the tax reserve, finance the rest and repay over the busy summer–autumn months.",
            ],
        ))

    warnings = []
    if res.days_below_zero:
        warnings.append(f"The forecast is below zero on {res.days_below_zero} days — arrange financing before then.")
    if not tax_facts:
        warnings.append(
            "This forecast uses this year's tax prepayments. Switch on 'Include expected tax changes' "
            "to see the impact of the expected back-payment and higher prepayments."
        )
    if gap:
        tail = "Financing is proposed to bridge the gap."
    elif facilities:
        tail = "The balance stays positive; a standby credit line is suggested for the summer shutdown."
    else:
        tail = "No extra financing is needed."
    res.source = "demo"
    res.facilities = facilities
    res.warnings = warnings
    res.summary = (
        f"Over the next {res.days} days the balance is expected to go from {eur(res.opening_balance)} "
        f"to about {eur(res.end_balance)}, with a low of {eur(res.min_balance)} on "
        f"{res.min_balance_date:%d %b %Y}. {tail}"
    )
    return res


# --- FX hedging agent -------------------------------------------------------------------------


def fx(exps: list[FxExposure]) -> FxResponse:
    if not exps:
        return FxResponse(source="demo", generated_at=_now(), exposures=[], risk_level="low", hedges=[],
                          summary="No foreign-currency payments found — no FX risk to hedge.")
    e = max(exps, key=lambda x: x.total_eur)
    c = e.currency
    hedges = [
        HedgeProposal(
            title=f"Lock the rate for future {c} payments",
            product="Commerzbank FX forward",
            notional=round(e.total_foreign / 2, -3),
            currency=c,
            tenor="3–12 months",
            protects_against=f"The {c} getting more expensive before you pay",
            cost="No upfront fee; the price is built into the agreed forward rate",
            plain_explanation=(
                f"You agree today on the exchange rate for a {c} payment you will make later. "
                "Whatever the market does, you know exactly how many euros it will cost."
            ),
            rationale=(
                f"In 2025 the rate moved between {e.rate_min} and {e.rate_max} EUR/{c}. Locked at January's "
                f"rate, the 12 instalments would have cost {eur(e.cost_with_forward_at_first_rate)} instead of "
                f"{eur(e.total_eur)} — and, more importantly, the cost would have been known in advance. "
                "Use it for any top-up or new instalment plan with Zurich."
            ),
            steps=[
                f"Tell your Commerzbank adviser the {c} amounts and dates you expect to pay.",
                "Hedge 50–100% of the known amounts; settle each forward on its payment date.",
            ],
        ),
        HedgeProposal(
            title=f"{c} account for Zurich flows",
            product=f"Commerzbank foreign-currency account ({c})",
            notional=0,
            currency=c,
            tenor="ongoing",
            protects_against="Converting back and forth at a bad moment",
            cost="Account fee only",
            plain_explanation=(
                f"Keep {c} received from Zurich (profit share) in a {c} account and use it for {c} "
                "payments, so you only convert when the rate suits you."
            ),
            rationale=f"Your stake of {c} {e.total_foreign:,.0f} will pay distributions in {c}.",
            steps=[f"Open a {c} sub-account.", "Ask the Zurich restaurant to pay distributions into it."],
        ),
        HedgeProposal(
            title=f"Protect expected {c} profit distributions",
            product="Commerzbank FX option",
            notional=round(e.total_foreign * 0.1, -2),
            currency=c,
            tenor="12 months",
            protects_against=f"A weaker {c} reducing the euros you receive",
            cost="One-off premium, typically a small percentage of the amount",
            plain_explanation=(
                f"Like insurance: you get the right (not the obligation) to sell {c} at a fixed rate. "
                f"If the {c} weakens you use it; if it strengthens you simply let it expire."
            ),
            rationale=(
                f"A 10% yearly return on the {c} {e.total_foreign:,.0f} stake would be about "
                f"{c} {e.total_foreign * 0.1:,.0f}. The rate already moved {e.rate_swing_pct}% within one year."
            ),
            steps=[
                "Agree the expected distribution amount and date with Zurich.",
                "Buy the option once the amount is known; size it to the expected amount.",
            ],
        ),
    ]
    return FxResponse(
        source="demo",
        generated_at=_now(),
        summary=(
            f"You paid {c} {e.total_foreign:,.0f} ({eur(e.total_eur)}) to Zurich in 12 instalments. The "
            f"exchange rate moved {e.rate_swing_pct}%, so the same {c} amount cost up to "
            f"{eur(e.extra_cost_vs_best_rate)} more than at the best rate. The instalments are finished, "
            f"but the {c} stake and its future distributions remain exposed."
        ),
        exposures=exps,
        risk_level="medium",
        hedges=hedges,
        warnings=[
            f"Any new {c} payment to Zurich (e.g. a top-up) should be hedged before you commit to it.",
            "FX products carry costs and obligations — discuss them with your Commerzbank adviser.",
        ],
    )
