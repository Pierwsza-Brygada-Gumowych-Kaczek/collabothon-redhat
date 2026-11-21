"""Account data and AI CFO agents for the logged-in user (all data comes from the database)."""

import re
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import UserRow, get_db
from app.routers.auth import to_user
from app.schemas import (
    AccountOverview,
    AiStatus,
    Goal,
    GoalCreate,
    GoalPlanRequest,
    GoalPlanResponse,
    ForecastResponse,
    FxResponse,
    InsightsResponse,
    LiquidityResponse,
    TaxTipsResponse,
    TransactionPage,
    User,
)
from app.services import fx, goals, insights, liquidity, repository, tax
from app.services.auth import current_user
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
def balance_forecast(
    days: int = Query(200, ge=7, le=365), acc: Account = Depends(get_account), db: Session = Depends(get_db)
) -> ForecastResponse:
    """Calculated daily balance forecast (no AI call) for the Overview chart, incl. payments into goals."""
    points, flows = liquidity.forecast(
        acc.txs, acc.user.opening_balance, days, goals=repository.list_goals(db, acc.user.id)
    )
    return ForecastResponse(as_of=acc.txs[-1].booking_date, days=days, forecast=points, scheduled=flows)


MAX_CACHED_PLANS = 40  # goal plans kept per user
MAX_PHOTO_CHARS = 1_500_000  # ~1 MB picture as a base64 data URL
_PHOTO_URL = re.compile(r"^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$")


def _check_photo(body: GoalCreate) -> None:
    """An uploaded image as a small data URL (or none)."""
    if not body.photo:
        body.photo = None
    elif len(body.photo) > MAX_PHOTO_CHARS or not _PHOTO_URL.match(body.photo):
        raise HTTPException(422, "The picture must be a PNG, JPEG, WebP or GIF image of up to 1 MB.")


# --- Goals (savings targets; the AI proposes ways to reach them) --------------------------


@router.get("/goals", response_model=list[Goal])
def list_goals(user: UserRow = Depends(current_user), db: Session = Depends(get_db)) -> list[Goal]:
    return goals.build_goals(repository.list_goals(db, user.id))


@router.post("/goals/plan", response_model=GoalPlanResponse)
async def plan_goal(
    body: GoalPlanRequest,
    request: Request,
    refresh: bool = False,
    acc: Account = Depends(get_account),
    ov: AccountOverview = Depends(get_overview),
    settings: Settings = Depends(get_settings),
) -> GoalPlanResponse:
    """Ways to reach a goal: monthly saving, deposits, funds… with duration and cost calculated.

    The same request (name, target, saved, deadline) is answered from the cache, so switching between ways
    or reopening a goal does not ask the model again. `refresh=true` generates a new answer.
    """
    body.name = body.name.strip()
    if not body.name:
        raise HTTPException(422, "Give the goal a name.")
    cache = _cache(request, acc.user.id)
    key = f"goal:{body.name.lower()}:{body.target:g}:{body.saved:g}:{body.deadline_months or 0}"
    if not refresh and key in cache:
        return cache[key]
    result = await goals.plan(request.app.state.ai, body, ov, acc.user.business, settings.agents_demo_fallback)
    # Keep the cache small: the oldest plans go first.
    plans = [k for k in cache if k.startswith("goal:")]
    for old in plans[: max(len(plans) - MAX_CACHED_PLANS + 1, 0)]:
        del cache[old]
    return _remember(cache, key, result)


def _forget_liquidity(request: Request, user_id: int) -> None:
    """Goals change the forecast, so cached liquidity answers are stale."""
    cache = _cache(request, user_id)
    for key in [k for k in cache if k.startswith("liquidity")]:
        del cache[key]


def _clean_goal(body: GoalCreate) -> None:
    body.name = body.name.strip()
    if not body.name:
        raise HTTPException(422, "Give the goal a name.")
    if body.icon and body.icon not in goals.GOAL_ICONS:
        raise HTTPException(422, "Choose one of the available icons.")
    body.icon = body.icon or None
    _check_photo(body)


@router.post("/goals", response_model=Goal, status_code=201)
def add_goal(
    body: GoalCreate, request: Request, user: UserRow = Depends(current_user), db: Session = Depends(get_db)
) -> Goal:
    _clean_goal(body)
    _forget_liquidity(request, user.id)
    return goals.build_goals([repository.add_goal(db, user.id, body)])[0]


@router.put("/goals/{goal_id}", response_model=Goal)
def update_goal(
    goal_id: str,
    body: GoalCreate,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(get_db),
) -> Goal:
    _clean_goal(body)
    _forget_liquidity(request, user.id)
    updated = repository.update_goal(db, user.id, goal_id, body)
    if updated is None:
        raise HTTPException(404, "Goal not found")
    return goals.build_goals([updated])[0]


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(
    goal_id: str, request: Request, user: UserRow = Depends(current_user), db: Session = Depends(get_db)
) -> Response:
    _forget_liquidity(request, user.id)
    if not repository.delete_goal(db, user.id, goal_id):
        raise HTTPException(404, "Goal not found")
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
    db: Session = Depends(get_db),
) -> LiquidityResponse:
    """Liquidity agent: cash-flow forecast `days` ahead and proposed credit facilities."""
    cache = _cache(request, acc.user.id)
    key = f"liquidity:{days}:{include_tax}"
    if refresh or key not in cache:
        facts = tax.build_facts(acc.txs) if include_tax else None
        result = await liquidity.generate(
            request.app.state.ai, acc.txs, acc.user.opening_balance, days, facts,
            ov.kpis.min_balance, ov.kpis.overdraft_days, settings.agents_demo_fallback,
            repository.list_goals(db, acc.user.id),
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
