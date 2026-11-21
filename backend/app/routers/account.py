"""Account data and AI CFO agents for the logged-in user (all data comes from the database)."""

import re
from dataclasses import dataclass
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import UserRow, get_db
from app.routers.auth import to_user
from app.schemas import (
    AccountOverview,
    AiStatus,
    Budget,
    BudgetCreate,
    BudgetOptions,
    ForecastResponse,
    FxResponse,
    InsightsResponse,
    LiquidityResponse,
    TaxTipsResponse,
    TransactionPage,
    User,
)
from app.services import fx, insights, liquidity, repository, tax
from app.services.auth import current_user
from app.services.budgets import PHOTOS, build_budgets, build_options
from app.services.statement import Transaction, build_overview, to_out

router = APIRouter(prefix="/api", tags=["account"])


@dataclass
class Account:
    user: UserRow
    txs: tuple[Transaction, ...]


def get_account(user: UserRow = Depends(current_user), db: Session = Depends(get_db)) -> Account:
    txs = repository.user_transactions(db, user.id)
    if not txs:
        raise HTTPException(409, "This account has no transactions yet.")
    return Account(user=user, txs=txs)


def get_overview(acc: Account = Depends(get_account)) -> AccountOverview:
    return build_overview(acc.txs, acc.user.opening_balance)


def get_today() -> date:
    return date.today()


def _cache(request: Request, user_id: int) -> dict:
    """Per-user cache of successful AI agent answers."""
    if not hasattr(request.app.state, "agent_cache"):
        request.app.state.agent_cache = {}
    return request.app.state.agent_cache.setdefault(user_id, {})


def _remember(cache: dict, key: str, result):
    """Cache successful AI answers only, so a failed call is retried on the next request."""
    if result.error is None:
        cache[key] = result
    return result


@router.get("/me", response_model=User)
def me(user: UserRow = Depends(current_user)) -> User:
    return to_user(user)


@router.get("/account/overview", response_model=AccountOverview)
def overview(ov: AccountOverview = Depends(get_overview)) -> AccountOverview:
    return ov


@router.get("/account/transactions", response_model=TransactionPage)
def transactions(
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    category: str | None = None,
    acc: Account = Depends(get_account),
) -> TransactionPage:
    txs = acc.txs[::-1]  # newest first
    if category:
        txs = tuple(t for t in txs if t.category == category)
    return TransactionPage(total=len(txs), items=[to_out(t) for t in txs[offset : offset + limit]])


@router.get("/forecast", response_model=ForecastResponse)
def balance_forecast(days: int = Query(200, ge=7, le=365), acc: Account = Depends(get_account)) -> ForecastResponse:
    """Calculated daily balance forecast (no AI call) for the Overview chart."""
    points, flows = liquidity.forecast(acc.txs, acc.user.opening_balance, days)
    return ForecastResponse(as_of=acc.txs[-1].booking_date, days=days, forecast=points, scheduled=flows)


# --- Budgets (stored per user in the database) ---------------------------------------------


MAX_PHOTO_CHARS = 1_500_000  # ~1 MB picture as a base64 data URL
_PHOTO_URL = re.compile(r"^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$")


def _clean_budget(body: BudgetCreate) -> None:
    """Normalise and validate a budget payload (shared by add and edit)."""
    body.name = body.name.strip()
    if not body.name:
        raise HTTPException(422, "Give the budget a name.")
    body.merchants = [m.strip() for m in body.merchants if m.strip()]
    body.category = (body.category or "").strip() or None
    if not body.category and not body.merchants:
        raise HTTPException(422, "Choose a category or a merchant to track.")
    if body.photo and body.photo not in PHOTOS:
        if len(body.photo) > MAX_PHOTO_CHARS or not _PHOTO_URL.match(body.photo):
            raise HTTPException(422, "The picture must be a PNG, JPEG, WebP or GIF image of up to 1 MB.")
    elif not body.photo:
        body.photo = None


@router.get("/budgets", response_model=list[Budget])
def budgets(
    acc: Account = Depends(get_account), db: Session = Depends(get_db), today: date = Depends(get_today)
) -> list[Budget]:
    """Monthly budgets: limit, spent, remaining, days until reset."""
    return build_budgets(acc.txs, repository.list_budgets(db, acc.user.id), today)


@router.get("/budgets/options", response_model=BudgetOptions)
def budget_options(acc: Account = Depends(get_account)) -> BudgetOptions:
    """Categories and merchants a new budget can track, with suggested monthly limits."""
    return build_options(acc.txs)


@router.post("/budgets", response_model=Budget, status_code=201)
def add_budget(
    body: BudgetCreate,
    acc: Account = Depends(get_account),
    db: Session = Depends(get_db),
    today: date = Depends(get_today),
) -> Budget:
    """Add a budget. It must track a category or at least one merchant."""
    _clean_budget(body)
    created = repository.add_budget(db, acc.user.id, body)
    return build_budgets(acc.txs, [created], today)[0]


@router.put("/budgets/{budget_id}", response_model=Budget)
def update_budget(
    budget_id: str,
    body: BudgetCreate,
    acc: Account = Depends(get_account),
    db: Session = Depends(get_db),
    today: date = Depends(get_today),
) -> Budget:
    """Edit every setting of a budget: name, description, tracked category/merchants, limit, picture."""
    _clean_budget(body)
    updated = repository.update_budget(db, acc.user.id, budget_id, body)
    if updated is None:
        raise HTTPException(404, "Budget not found")
    return build_budgets(acc.txs, [updated], today)[0]


@router.delete("/budgets/{budget_id}", status_code=204)
def delete_budget(budget_id: str, user: UserRow = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    if not repository.delete_budget(db, user.id, budget_id):
        raise HTTPException(404, "Budget not found")
    return Response(status_code=204)


# --- AI CFO agents --------------------------------------------------------------------------
# Facts are calculated from the user's transactions; recommendations come from the OpenShift AI
# model (or labelled demo content while it is not connected). Successful answers are cached per
# user until `refresh=true`.


@router.get("/ai/status", response_model=AiStatus)
async def ai_status(request: Request, _: UserRow = Depends(current_user)) -> AiStatus:
    """Is the OpenShift AI model configured, reachable and serving the configured model name?"""
    return AiStatus(**await request.app.state.ai.status(), demo_fallback=get_settings().agents_demo_fallback)


@router.get("/insights", response_model=InsightsResponse)
async def get_insights(
    request: Request,
    refresh: bool = False,
    acc: Account = Depends(get_account),
    ov: AccountOverview = Depends(get_overview),
    settings: Settings = Depends(get_settings),
) -> InsightsResponse:
    """Investment agent: deposits, money market funds, ETF savings and capex financing."""
    cache = _cache(request, acc.user.id)
    if refresh or "insights" not in cache:
        result = await insights.generate(request.app.state.ai, ov, acc.user.business, settings.agents_demo_fallback)
        return _remember(cache, "insights", result)
    return cache["insights"]


@router.get("/tax-tips", response_model=TaxTipsResponse)
async def tax_tips(
    request: Request,
    refresh: bool = False,
    acc: Account = Depends(get_account),
    settings: Settings = Depends(get_settings),
) -> TaxTipsResponse:
    """Tax agent: advance payment schedule and legal optimisation opportunities."""
    cache = _cache(request, acc.user.id)
    if refresh or "tax" not in cache:
        return _remember(cache, "tax", await tax.generate(request.app.state.ai, acc.txs, settings.agents_demo_fallback))
    return cache["tax"]


@router.get("/liquidity", response_model=LiquidityResponse)
async def liquidity_forecast(
    request: Request,
    days: int = Query(90, ge=7, le=365),
    include_tax: bool = False,
    refresh: bool = False,
    acc: Account = Depends(get_account),
    ov: AccountOverview = Depends(get_overview),
    settings: Settings = Depends(get_settings),
) -> LiquidityResponse:
    """Liquidity agent: cash-flow forecast `days` ahead and proposed credit facilities."""
    cache = _cache(request, acc.user.id)
    key = f"liquidity:{days}:{include_tax}"
    if refresh or key not in cache:
        facts = tax.build_facts(acc.txs) if include_tax else None
        result = await liquidity.generate(
            request.app.state.ai, acc.txs, acc.user.opening_balance, days, facts,
            ov.kpis.min_balance, ov.kpis.overdraft_days, settings.agents_demo_fallback,
        )
        return _remember(cache, key, result)
    return cache[key]


@router.get("/fx", response_model=FxResponse)
async def fx_hedging(
    request: Request,
    refresh: bool = False,
    acc: Account = Depends(get_account),
    settings: Settings = Depends(get_settings),
) -> FxResponse:
    """FX hedging agent: currency exposures and proposed Commerzbank hedges."""
    cache = _cache(request, acc.user.id)
    if refresh or "fx" not in cache:
        return _remember(cache, "fx", await fx.generate(request.app.state.ai, acc.txs, settings.agents_demo_fallback))
    return cache["fx"]
