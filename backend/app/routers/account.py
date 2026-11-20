from datetime import date

from fastapi import APIRouter, Depends, Query, Request

from app.config import Settings, get_settings
from app.schemas import (
    AccountOverview,
    AiStatus,
    Budget,
    FxResponse,
    InsightsResponse,
    LiquidityResponse,
    TaxTipsResponse,
    TransactionPage,
    User,
)
from app.services import fx, insights, liquidity, tax
from app.services.budgets import build_budgets
from app.services.statement import build_overview, load_transactions, to_out

router = APIRouter(prefix="/api", tags=["account"])

# Prototype: no login — every visitor is immediately "signed in" as this user.
DUMMY_USER = User(
    id="demo-vincenzo",
    name="Vincenzo Amalfi",
    business="Pizzeria Amalfi",
    email="vincenzo@pizzeria-amalfi.example",
    initials="VA",
    segment="Business client · SME",
)


def get_overview(settings: Settings = Depends(get_settings)) -> AccountOverview:
    txs = load_transactions(settings.statement_csv_path)
    return build_overview(txs, settings.statement_opening_balance)


def get_today() -> date:
    return date.today()


def _cache(request: Request) -> dict:
    if not hasattr(request.app.state, "agent_cache"):
        request.app.state.agent_cache = {}
    return request.app.state.agent_cache


def _remember(cache: dict, key: str, result):
    """Cache successful AI answers only, so a failed call is retried on the next request."""
    if result.error is None:
        cache[key] = result
    return result


@router.get("/me", response_model=User)
async def me() -> User:
    return DUMMY_USER


@router.get("/account/overview", response_model=AccountOverview)
async def overview(ov: AccountOverview = Depends(get_overview)) -> AccountOverview:
    return ov


@router.get("/account/transactions", response_model=TransactionPage)
async def transactions(
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    category: str | None = None,
    settings: Settings = Depends(get_settings),
) -> TransactionPage:
    txs = load_transactions(settings.statement_csv_path)[::-1]  # newest first
    if category:
        txs = tuple(t for t in txs if t.category == category)
    return TransactionPage(total=len(txs), items=[to_out(t) for t in txs[offset : offset + limit]])


@router.get("/budgets", response_model=list[Budget])
async def budgets(
    settings: Settings = Depends(get_settings), today: date = Depends(get_today)
) -> list[Budget]:
    """Monthly budgets: limit, spent, remaining, days until reset."""
    return build_budgets(load_transactions(settings.statement_csv_path), today)


# --- AI CFO agents --------------------------------------------------------------------------
# Facts are calculated from the statement; recommendations come ONLY from the OpenShift AI model.
# If the model fails, the response has `error` set and no recommendations. Successful answers are
# cached until `refresh=true`.


@router.get("/ai/status", response_model=AiStatus)
async def ai_status(request: Request) -> AiStatus:
    """Is the OpenShift AI model configured, reachable and serving the configured model name?"""
    return AiStatus(**await request.app.state.ai.status(), demo_fallback=get_settings().agents_demo_fallback)


@router.get("/insights", response_model=InsightsResponse)
async def get_insights(
    request: Request, refresh: bool = False, ov: AccountOverview = Depends(get_overview)
) -> InsightsResponse:
    """Investment agent: deposits, money market funds, ETF savings and capex financing."""
    cache = _cache(request)
    if refresh or "insights" not in cache:
        return _remember(cache, "insights", await insights.generate(request.app.state.ai, ov, DUMMY_USER.business, get_settings().agents_demo_fallback))
    return cache["insights"]


@router.get("/tax-tips", response_model=TaxTipsResponse)
async def tax_tips(
    request: Request, refresh: bool = False, settings: Settings = Depends(get_settings)
) -> TaxTipsResponse:
    """Tax agent: advance payment schedule and legal optimisation opportunities."""
    cache = _cache(request)
    if refresh or "tax" not in cache:
        txs = load_transactions(settings.statement_csv_path)
        return _remember(cache, "tax", await tax.generate(request.app.state.ai, txs, settings.agents_demo_fallback))
    return cache["tax"]


@router.get("/liquidity", response_model=LiquidityResponse)
async def liquidity_forecast(
    request: Request,
    days: int = Query(90, ge=7, le=365),
    include_tax: bool = False,
    refresh: bool = False,
    settings: Settings = Depends(get_settings),
    ov: AccountOverview = Depends(get_overview),
) -> LiquidityResponse:
    """Liquidity agent: cash-flow forecast `days` ahead and proposed credit facilities."""
    cache = _cache(request)
    key = f"liquidity:{days}:{include_tax}"
    if refresh or key not in cache:
        txs = load_transactions(settings.statement_csv_path)
        facts = tax.build_facts(txs) if include_tax else None
        result = await liquidity.generate(
            request.app.state.ai, txs, settings.statement_opening_balance, days, facts,
            ov.kpis.min_balance, ov.kpis.overdraft_days, settings.agents_demo_fallback,
        )
        return _remember(cache, key, result)
    return cache[key]


@router.get("/fx", response_model=FxResponse)
async def fx_hedging(
    request: Request, refresh: bool = False, settings: Settings = Depends(get_settings)
) -> FxResponse:
    """FX hedging agent: currency exposures and proposed Commerzbank hedges."""
    cache = _cache(request)
    if refresh or "fx" not in cache:
        txs = load_transactions(settings.statement_csv_path)
        return _remember(cache, "fx", await fx.generate(request.app.state.ai, txs, settings.agents_demo_fallback))
    return cache["fx"]
