from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

# "demo" = rule-based demo recommendations while the model is not connected (AGENTS_DEMO_FALLBACK)
AgentSource = Literal["openshift-ai", "demo", "unavailable"]
Risk = Literal["low", "medium", "high"]
Difficulty = Literal["easy", "medium", "hard"]


class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1)
    max_tokens: int = Field(default=512, ge=1, le=8192)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)


class ChatResponse(BaseModel):
    message: Message
    model: str


# --- Account / statement ---


class User(BaseModel):
    id: str
    username: str = ""
    name: str
    business: str
    email: str
    initials: str
    segment: str


class TransactionOut(BaseModel):
    date: date
    type: str
    reference: str
    counterparty: str
    amount: float
    currency: str
    amount_eur: float
    category: str


class TransactionPage(BaseModel):
    total: int
    items: list[TransactionOut]


class DailyBalance(BaseModel):
    date: date
    balance: float


class MonthlySummary(BaseModel):
    month: str
    label: str
    income: float
    expenses: float
    net: float
    end_balance: float


class CategoryTotal(BaseModel):
    name: str
    amount: float


class Kpis(BaseModel):
    total_income: float
    total_expenses: float
    net_result: float
    min_balance: float
    min_balance_date: date
    overdraft_days: int
    avg_monthly_income: float
    avg_monthly_expenses: float
    swiss_transfers_eur: float
    swiss_transfers_count: int


class AccountOverview(BaseModel):
    account_iban: str
    currency: str
    period_from: date
    period_to: date
    opening_balance: float
    balance: float
    kpis: Kpis
    monthly: list[MonthlySummary]
    daily_balance: list[DailyBalance]
    categories: list[CategoryTotal]
    # Spending by category in the latest month of the statement (positive amounts, largest first).
    month_categories: list[CategoryTotal] = []


# --- Goals (savings targets with AI-proposed ways to reach them) ---

GoalFrequency = Literal["one-off", "weekly", "monthly", "quarterly"]


class GoalPlanRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    target: float = Field(gt=0, le=100_000_000)
    saved: float = Field(default=0, ge=0, le=100_000_000)
    # Wish to reach the goal within N months; empty = the AI proposes payments the account can afford.
    deadline_months: int | None = Field(default=None, ge=1, le=600)


class GoalWay(BaseModel):
    """One way to fill a goal. Numbers (duration, total paid, interest) are calculated, not written by the AI."""

    id: str
    title: str
    category: str = "Savings"
    frequency: GoalFrequency = "monthly"
    amount_eur: float = Field(ge=0)  # per payment (a single deposit for "one-off")
    payments: int = 1
    months: int | None = None  # None = the goal is not reached within 50 years
    total_paid: float = 0
    expected_interest: float = 0
    risk: Risk = "low"
    return_min_pct: float = 0
    return_max_pct: float = 0
    plain_explanation: str = ""
    rationale: str = ""
    # Months sooner than plain regular saving of the same monthly amount (negative = later);
    # None for the baseline itself.
    months_faster: int | None = None


class GoalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=120)
    target: float = Field(gt=0, le=100_000_000)
    saved: float = Field(default=0, ge=0, le=100_000_000)
    deadline_months: int | None = Field(default=None, ge=1, le=600)
    photo: str | None = None
    # One of the preset icon keys (see GOAL_ICONS in services/goals.py), or none.
    icon: str | None = Field(default=None, max_length=30)
    way: GoalWay | None = None


class GoalDefinition(GoalCreate):
    id: str
    created: date


class Goal(GoalDefinition):
    remaining: float
    percent: float


class AgentMeta(BaseModel):
    """Common header of every agent response."""

    source: AgentSource
    model: str | None = None
    generated_at: datetime
    # Written by the model. Empty when the model is unavailable.
    summary: str = ""
    warnings: list[str] = []
    # Set when the model could not be used — the page shows it instead of AI recommendations.
    error: str | None = None


class GoalPlanResponse(AgentMeta):
    ways: list[GoalWay]
    # The standard alternative the ways are compared with: setting aside the same sum every month.
    baseline: GoalWay | None = None


# --- Investment agent ---


class InvestmentProposal(BaseModel):
    title: str
    # "investment" = you put money in; "financing" = the bank lends you money (capex).
    kind: Literal["investment", "financing"] = "investment"
    category: str = "Other"
    amount_eur: float = Field(default=0, ge=0)
    contribution: Literal["one-off", "monthly"] = "one-off"
    horizon_months: int = Field(default=12, ge=1, le=600)
    risk: Risk = "medium"
    # Investment: expected annual return range in %. Financing: annual interest rate range in %.
    return_min_pct: float = 0
    return_max_pct: float = 0
    plain_explanation: str = ""
    rationale: str = ""


class InsightsResponse(AgentMeta):
    proposals: list[InvestmentProposal]


# --- Tax agent ---


class TaxFacts(BaseModel):
    year: int
    revenue: float
    business_expenses: float
    estimated_profit: float
    prepayment_basis: float
    income_tax_prepaid: float
    trade_tax_prepaid: float
    wage_tax_paid: float
    social_security_paid: float
    owner_withdrawals: float
    estimated_income_tax: float
    estimated_additional_payment: float
    marginal_rate_pct: float
    vat_payments_found: bool
    estimated_trade_tax: float
    recommended_quarterly_prepayment: float
    monthly_tax_reserve: float


class TaxPayment(BaseModel):
    date: date
    tax: str
    current_amount: float
    recommended_amount: float
    note: str = ""


class TaxTip(BaseModel):
    title: str
    category: str = "Other"
    saving_min_eur: float = Field(default=0, ge=0)
    saving_max_eur: float = Field(default=0, ge=0)
    difficulty: Difficulty = "medium"
    when: str = ""
    plain_explanation: str = ""
    steps: list[str] = []
    rationale: str = ""
    legal_basis: str = ""


class TaxTipsResponse(AgentMeta):
    facts: TaxFacts
    schedule: list[TaxPayment]
    tips: list[TaxTip]


# --- Liquidity agent ---


class ForecastPoint(BaseModel):
    date: date
    balance: float
    low: float
    high: float
    # Expected money in that day (card revenue, last year's daily average for the month).
    expected_in: float = 0


class ScheduledFlow(BaseModel):
    date: date
    label: str
    amount: float


class ForecastResponse(BaseModel):
    """Calculated balance forecast only (no AI) — used by the Overview chart."""

    as_of: date
    days: int
    forecast: list[ForecastPoint]
    scheduled: list[ScheduledFlow]


class CreditFacility(BaseModel):
    title: str
    product: str = ""
    limit_eur: float = Field(default=0, ge=0)
    term: str = ""
    interest_min_pct: float = 0
    interest_max_pct: float = 0
    est_cost_eur: float = 0
    plain_explanation: str = ""
    rationale: str = ""
    steps: list[str] = []


class LiquidityResponse(AgentMeta):
    as_of: date
    days: int
    opening_balance: float
    forecast: list[ForecastPoint]
    scheduled: list[ScheduledFlow]
    min_balance: float
    min_balance_date: date
    days_below_zero: int
    end_balance: float
    overdraft_cost_last_year: float
    facilities: list[CreditFacility]


# --- FX hedging agent ---


class FxPayment(BaseModel):
    date: date
    amount: float
    currency: str
    rate: float
    amount_eur: float


class FxExposure(BaseModel):
    currency: str
    counterparty: str
    payments: list[FxPayment]
    total_foreign: float
    total_eur: float
    rate_min: float
    rate_max: float
    rate_avg: float
    rate_swing_pct: float
    extra_cost_vs_best_rate: float
    cost_with_forward_at_first_rate: float
    open_position_foreign: float
    open_position_note: str


class HedgeProposal(BaseModel):
    title: str
    product: str = ""
    notional: float = Field(default=0, ge=0)
    currency: str = "CHF"
    tenor: str = ""
    protects_against: str = ""
    cost: str = ""
    plain_explanation: str = ""
    rationale: str = ""
    steps: list[str] = []


class FxResponse(AgentMeta):
    exposures: list[FxExposure]
    risk_level: Risk | None = None
    hedges: list[HedgeProposal]


class AiStatus(BaseModel):
    configured: bool
    url: str
    model: str
    reachable: bool
    model_found: bool
    available_models: list[str]
    demo_fallback: bool = False
    error: str | None = None
