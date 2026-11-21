import json
from datetime import date

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import logged_in

MODEL_URL = "http://localhost:8080/v1"


def model_reply(content: dict) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]})


@pytest.fixture
def model_down():
    with respx.mock:
        respx.post(f"{MODEL_URL}/chat/completions").mock(side_effect=httpx.ConnectError("down"))
        respx.get(f"{MODEL_URL}/models").mock(side_effect=httpx.ConnectError("down"))
        yield


def test_me_returns_dummy_user():
    with logged_in(create_app()) as client:
        assert client.get("/api/me").json()["name"] == "Vincenzo Amalfi"


def test_overview_matches_sample_data():
    with logged_in(create_app()) as client:
        ov = client.get("/api/account/overview").json()
    assert round(ov["balance"], 0) == 33266  # closing balance from the scenario sheet
    assert ov["kpis"]["min_balance"] < -20000  # dip after the June shutdown
    assert ov["kpis"]["swiss_transfers_count"] == 12
    assert [m["label"] for m in ov["monthly"]][:2] == ["Jan", "Feb"]


def test_transactions_newest_first_and_filter():
    with logged_in(create_app()) as client:
        page = client.get("/api/account/transactions?limit=5").json()
        rent = client.get("/api/account/transactions?category=Rent").json()
    assert page["total"] == 1125
    assert page["items"][0]["date"] == "2025-12-31"
    assert rent["total"] == 12


# --- Investment agent ---


@respx.mock
def test_insights_from_model_normalises_values():
    content = {
        "summary": "OK",
        "proposals": [
            {"title": "Deposit", "amount_eur": "10,000", "risk": "LOW", "contribution": "monthly",
             "horizon_months": "6", "return_min_pct": "3%", "return_max_pct": 2},
            {"title": "Oven loan", "kind": "financing", "amount_eur": 25000},
        ],
    }
    route = respx.post(f"{MODEL_URL}/chat/completions").mock(return_value=model_reply(content))
    with logged_in(create_app()) as client:
        r = client.get("/api/insights?refresh=true").json()
    p = r["proposals"][0]
    assert r["source"] == "openshift-ai" and r["error"] is None
    assert (p["amount_eur"], p["risk"], p["contribution"], p["horizon_months"]) == (10000, "low", "monthly", 6)
    assert (p["return_min_pct"], p["return_max_pct"]) == (2, 3)
    assert r["proposals"][1]["kind"] == "financing"
    sent = json.loads(route.calls.last.request.content)
    assert sent["response_format"] == {"type": "json_object"}  # JSON mode on by default


def test_insights_without_model_returns_error_and_no_proposals(model_down):
    with logged_in(create_app()) as client:
        r = client.get("/api/insights?refresh=true").json()
    assert r["source"] == "unavailable"
    assert "Cannot connect" in r["error"]
    assert r["proposals"] == [] and r["summary"] == ""


@respx.mock
def test_invalid_model_json_is_an_error_not_cached():
    route = respx.post(f"{MODEL_URL}/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "Sorry, I cannot help."}}]})
    )
    with logged_in(create_app()) as client:
        first = client.get("/api/insights").json()
        client.get("/api/insights")
    assert first["source"] == "unavailable" and "JSON" in first["error"]
    assert route.call_count == 2  # failures are not cached, the next request retries


@respx.mock
def test_model_auth_error_is_explained():
    respx.post(f"{MODEL_URL}/chat/completions").mock(return_value=httpx.Response(401))
    with logged_in(create_app()) as client:
        r = client.get("/api/insights?refresh=true").json()
    assert "OPENSHIFT_AI_TOKEN" in r["error"]


# --- Tax agent ---


def test_income_tax_formula_known_points():
    from app.services.tax import income_tax_2025

    assert income_tax_2025(12_096) == 0
    assert round(income_tax_2025(100_000)) == 31_088  # 0.42 * 100,000 - 10,911.92


def test_tax_without_model_keeps_facts_and_schedule_but_no_tips(model_down):
    with logged_in(create_app()) as client:
        r = client.get("/api/tax-tips?refresh=true").json()
    f = r["facts"]
    assert r["source"] == "unavailable" and r["error"] and r["tips"] == []
    assert 100_000 < f["estimated_profit"] < 150_000  # far above the €30k prepayment basis
    assert f["estimated_additional_payment"] > 20_000
    income = [p for p in r["schedule"] if p["tax"] == "Income tax prepayment"]
    assert [p["date"] for p in income] == ["2026-03-10", "2026-06-10", "2026-09-10", "2026-12-10"]
    assert all(p["recommended_amount"] > p["current_amount"] for p in income)


@respx.mock
def test_tax_tips_from_model():
    content = {"summary": "OK", "tips": [{"title": "Deduction", "saving_min_eur": "5,000", "saving_max_eur": 2000,
                                          "difficulty": "HARD", "steps": "one step"}]}
    respx.post(f"{MODEL_URL}/chat/completions").mock(return_value=model_reply(content))
    with logged_in(create_app()) as client:
        r = client.get("/api/tax-tips?refresh=true").json()
    t = r["tips"][0]
    assert r["source"] == "openshift-ai" and r["schedule"]
    assert (t["saving_min_eur"], t["saving_max_eur"], t["difficulty"], t["steps"]) == (2000, 5000, "hard", ["one step"])


@respx.mock
def test_tax_tips_that_save_nothing_are_not_shown():
    content = {"summary": "OK", "tips": [
        {"title": "Raise prepayments", "saving_min_eur": 0, "saving_max_eur": 0},
        {"title": "Tiny", "saving_min_eur": 0, "saving_max_eur": 10},
        {"title": "Pension contribution", "saving_min_eur": 800, "saving_max_eur": 1500},
    ]}
    respx.post(f"{MODEL_URL}/chat/completions").mock(return_value=model_reply(content))
    with logged_in(create_app()) as client:
        r = client.get("/api/tax-tips?refresh=true").json()
    assert [t["title"] for t in r["tips"]] == ["Pension contribution"]


@respx.mock
def test_tax_reply_with_only_worthless_tips_counts_as_unusable():
    content = {"summary": "OK", "tips": [{"title": "Raise prepayments", "saving_min_eur": 0, "saving_max_eur": 0}]}
    respx.post(f"{MODEL_URL}/chat/completions").mock(return_value=model_reply(content))
    with logged_in(create_app()) as client:
        r = client.get("/api/tax-tips?refresh=true").json()
    assert r["source"] == "unavailable" and r["tips"] == [] and "save money" in r["error"]


# --- Liquidity agent ---


def test_liquidity_forecast_is_calculated_even_without_model(model_down):
    with logged_in(create_app()) as client:
        r = client.get("/api/liquidity?days=90&refresh=true").json()
        r_tax = client.get("/api/liquidity?days=180&include_tax=true&refresh=true").json()
    assert r["error"] and r["facilities"] == [] and r["summary"] == ""
    assert r["as_of"] == "2025-12-31" and len(r["forecast"]) == 90
    assert r["forecast"][0]["date"] == "2026-01-01"
    assert any(s["label"] == "Rent" and s["date"] == "2026-01-01" for s in r["scheduled"])
    assert not any("Swiss" in s["label"] for s in r["scheduled"])  # instalments have ended
    assert r["overdraft_cost_last_year"] > 0
    assert all(p["expected_in"] > 0 for p in r["forecast"])  # January card revenue
    by_wd = {}
    for p in r["forecast"][:14]:
        by_wd[date.fromisoformat(p["date"]).weekday()] = p["expected_in"]
    assert by_wd[0] > 3 * by_wd[2]  # Monday card payouts far above a Wednesday
    assert r_tax["min_balance"] < r["min_balance"]  # the tax back-payment makes it worse
    assert any("back-payment" in s["label"] for s in r_tax["scheduled"])


@respx.mock
def test_liquidity_facilities_from_model():
    content = {"summary": "Tight in June.", "facilities": [
        {"title": "Credit line", "product": "Business credit line", "limit_eur": "30,000",
         "interest_min_pct": 11, "interest_max_pct": 8, "steps": ["apply"]}]}
    respx.post(f"{MODEL_URL}/chat/completions").mock(return_value=model_reply(content))
    with logged_in(create_app()) as client:
        r = client.get("/api/liquidity?days=180&refresh=true").json()
    f = r["facilities"][0]
    assert r["source"] == "openshift-ai" and r["summary"] == "Tight in June."
    assert (f["limit_eur"], f["interest_min_pct"], f["interest_max_pct"]) == (30000, 8, 11)
    assert len(r["forecast"]) == 180


# --- FX agent ---


def test_fx_exposure_calculated_without_model(model_down):
    with logged_in(create_app()) as client:
        r = client.get("/api/fx?refresh=true").json()
    e = r["exposures"][0]
    assert r["error"] and r["hedges"] == [] and r["risk_level"] is None
    assert e["currency"] == "CHF" and len(e["payments"]) == 12
    assert round(e["total_foreign"]) == 50000
    assert e["rate_max"] > e["rate_min"] and e["extra_cost_vs_best_rate"] > 0


@respx.mock
def test_fx_hedges_from_model():
    content = {"summary": "CHF risk.", "risk_level": "High",
               "hedges": [{"title": "Forward", "product": "Commerzbank FX forward", "notional": "25,000"}]}
    respx.post(f"{MODEL_URL}/chat/completions").mock(return_value=model_reply(content))
    with logged_in(create_app()) as client:
        r = client.get("/api/fx?refresh=true").json()
    assert r["risk_level"] == "high" and r["hedges"][0]["notional"] == 25000


# --- AI status ---


@respx.mock
def test_ai_status_reports_missing_model():
    respx.get(f"{MODEL_URL}/models").mock(
        return_value=httpx.Response(200, json={"data": [{"id": "llama-3"}]})
    )
    with logged_in(create_app()) as client:
        s = client.get("/api/ai/status").json()
    assert s["reachable"] and not s["model_found"]
    assert s["available_models"] == ["llama-3"] and "OPENSHIFT_AI_MODEL" in s["error"]


# --- Demo mode (AGENTS_DEMO_FALLBACK=true, model not connected) ---


@pytest.fixture
def demo_mode(monkeypatch, model_down):
    from app.config import get_settings

    monkeypatch.setenv("AGENTS_DEMO_FALLBACK", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_demo_mode_returns_labelled_demo_recommendations(demo_mode):
    with logged_in(create_app()) as client:
        ins = client.get("/api/insights?refresh=true").json()
        tx = client.get("/api/tax-tips?refresh=true").json()
        liq = client.get("/api/liquidity?days=180&include_tax=true&refresh=true").json()
        fx = client.get("/api/fx?refresh=true").json()
        status = client.get("/api/ai/status").json()
    assert all(r["source"] == "demo" and r["error"] for r in (ins, tx, liq, fx))
    assert {"Fixed-term deposit", "Money market fund", "Capex financing"} <= {p["category"] for p in ins["proposals"]}
    assert len(tx["tips"]) >= 4 and tx["schedule"]
    assert liq["facilities"] and liq["summary"]
    assert fx["hedges"] and fx["risk_level"] == "medium"
    assert status["demo_fallback"] is True


def test_forecast_endpoint_is_calculated_without_ai():
    with logged_in(create_app()) as client:
        r = client.get("/api/forecast?days=200").json()
    assert r["as_of"] == "2025-12-31" and len(r["forecast"]) == 200
    assert r["scheduled"] and all("expected_in" in p for p in r["forecast"])


@pytest.fixture
def plain_app():
    return create_app()


# --- Goals ---


def test_goal_plan_calculates_duration_and_cost(demo_mode):
    with logged_in(create_app()) as client:
        r = client.post("/api/goals/plan", json={"name": "New oven", "target": 6000, "saved": 600})
        assert r.status_code == 200
        plan = r.json()
        assert plan["source"] == "demo" and len(plan["ways"]) >= 2
        # Only ways that reach the goal and differ from plain saving (the standard way) are proposed.
        assert all(w["months"] is not None and w["category"] != "Savings" for w in plan["ways"])
        for w in plan["ways"]:
            if w["months"] is not None:
                # What is paid in plus interest and the savings so far reaches the target.
                assert w["total_paid"] + w["expected_interest"] + 600 >= 6000 - 1

        with_deadline = client.post(
            "/api/goals/plan", json={"name": "New oven", "target": 6000, "saved": 0, "deadline_months": 12}
        ).json()
        monthly = next(w for w in with_deadline["ways"] if w["frequency"] == "monthly")
        assert monthly["months"] <= 12 and 450 < monthly["amount_eur"] < 520

        # Every plan is compared with plain regular saving (same monthly sum, no interest).
        base = with_deadline["baseline"]
        assert base["id"] == "baseline" and base["months"] == 12 and base["total_paid"] == 6000
        assert base["amount_eur"] == 500 and base["expected_interest"] == 0
        for w in with_deadline["ways"]:
            assert w["months_faster"] is not None and w["months_faster"] >= 0  # interest never makes it slower
        assert plan["baseline"]["months"] > 0 and all("months_faster" in w for w in plan["ways"])


def test_goal_icon_is_validated_and_saved(plain_app):
    with logged_in(plain_app) as client:
        r = client.post("/api/goals", json={"name": "Oven", "target": 6000, "icon": "chef-hat"})
        assert r.status_code == 201 and r.json()["icon"] == "chef-hat"
        assert client.get("/api/goals").json()[0]["icon"] == "chef-hat"
        assert client.post("/api/goals", json={"name": "Bad", "target": 10, "icon": "<script>"}).status_code == 422
        assert client.put("/api/goals/oven", json={"name": "Oven", "target": 6000}).json()["icon"] is None


def test_goal_add_edit_delete(plain_app):
    with logged_in(plain_app) as client:
        way = {"id": "way-1", "title": "Save monthly", "frequency": "monthly", "amount_eur": 250, "months": 24}
        r = client.post("/api/goals", json={"name": "Oven", "target": 6000, "saved": 1500, "way": way})
        assert r.status_code == 201
        g = r.json()
        assert g["id"] == "oven" and g["percent"] == 25.0 and g["remaining"] == 4500 and g["way"]["months"] == 24

        r = client.put("/api/goals/oven", json={"name": "Big oven", "target": 8000, "saved": 2000,
                                               "photo": "data:image/jpeg;base64,/9j/4AAQ"})
        assert r.status_code == 200 and r.json()["name"] == "Big oven" and r.json()["way"] is None
        assert client.put("/api/goals/oven", json={"name": "x", "target": 1, "photo": "http://evil/x.png"}).status_code == 422
        assert client.put("/api/goals/nope", json={"name": "x", "target": 1}).status_code == 404

        assert [x["id"] for x in client.get("/api/goals").json()] == ["oven"]
        assert client.delete("/api/goals/oven").status_code == 204
        assert client.get("/api/goals").json() == []


def test_goal_payments_are_part_of_the_forecast(plain_app):
    with logged_in(plain_app) as client:
        before = client.get("/api/forecast?days=120").json()
        way = {"id": "way-1", "title": "Save monthly", "frequency": "monthly", "amount_eur": 500,
               "payments": 3, "months": 3}
        client.post("/api/goals", json={"name": "Oven", "target": 1500, "way": way})
        after = client.get("/api/forecast?days=120").json()

        flows = [f for f in after["scheduled"] if f["label"] == "Goal: Oven"]
        assert len(flows) == 3 and all(f["amount"] == -500 for f in flows)
        assert all(f["date"].endswith("-01") for f in flows)
        # Balance after the last payment is exactly EUR 1,500 lower than without the goal.
        assert round(before["forecast"][-1]["balance"] - after["forecast"][-1]["balance"], 2) == 1500
        assert not [f for f in before["scheduled"] if f["label"].startswith("Goal:")]


def test_overview_has_latest_month_spending_by_category(plain_app):
    with logged_in(plain_app) as client:
        o = client.get("/api/account/overview").json()
    cats = o["month_categories"]
    assert cats and all(c["amount"] > 0 for c in cats)
    assert cats == sorted(cats, key=lambda c: -c["amount"])
    assert round(sum(c["amount"] for c in cats), 2) == o["monthly"][-1]["expenses"]


def test_profile_update_and_password_change():
    app = create_app()
    with logged_in(app) as client:
        me = client.get("/api/auth/me").json()
        assert me["username"] == "demo"

        r = client.put("/api/auth/me", json={"name": "Anna Nowak", "business": "Trattoria", "email": "anna@example.com"})
        assert r.status_code == 200 and r.json()["name"] == "Anna Nowak" and r.json()["initials"] == "AN"
        assert client.get("/api/auth/me").json()["business"] == "Trattoria"
        assert client.put("/api/auth/me", json={"name": "  ", "email": ""}).status_code == 422
        assert client.put("/api/auth/me", json={"name": "A", "email": "not-an-email"}).status_code == 422

        wrong = client.post("/api/auth/password", json={"current_password": "nope", "new_password": "longenough1"})
        assert wrong.status_code == 403
        assert client.post("/api/auth/password", json={"current_password": "demo", "new_password": "short"}).status_code == 422
        assert client.post("/api/auth/password", json={"current_password": "demo", "new_password": "longenough1"}).status_code == 204

    with TestClient(app) as client:
        assert client.post("/api/auth/login", json={"username": "demo", "password": "demo"}).status_code == 401
        assert client.post("/api/auth/login", json={"username": "demo", "password": "longenough1"}).status_code == 200


def _plan_reply():
    return {"summary": "OK", "ways": [
        {"title": "ETF plan", "category": "ETF savings plan", "frequency": "monthly", "amount_eur": 400,
         "return_min_pct": 4, "return_max_pct": 6, "risk": "medium"},
        {"title": "Money market fund", "category": "Money market fund", "frequency": "monthly", "amount_eur": 450,
         "return_min_pct": 2, "return_max_pct": 3},
    ]}


@respx.mock
def test_goal_plans_are_cached_per_request_and_refresh_regenerates():
    route = respx.post(f"{MODEL_URL}/chat/completions").mock(return_value=model_reply(_plan_reply()))
    body = {"name": "New oven", "target": 6000, "saved": 0}
    with logged_in(create_app()) as client:
        first = client.post("/api/goals/plan", json=body).json()
        again = client.post("/api/goals/plan", json=body).json()
        assert first["source"] == "openshift-ai" and again == first
        assert route.call_count == 1  # second answer came from the cache

        client.post("/api/goals/plan", json={**body, "target": 7000})  # another goal needs its own answer
        assert route.call_count == 2

        client.post("/api/goals/plan?refresh=true", json=body)
        assert route.call_count == 3


def test_ways_that_never_reach_the_goal_are_not_proposed():
    from app.schemas import GoalPlanRequest
    from app.services.goals import compare_to_baseline, drop_pointless, finalize

    req = GoalPlanRequest(name="Oven", target=50_000, saved=0)
    raw = [
        {"title": "Fixed-term deposit", "frequency": "one-off", "amount_eur": 5000, "return_min_pct": 2, "return_max_pct": 3},
        {"title": "ETF plan", "frequency": "monthly", "amount_eur": 1500, "return_min_pct": 4, "return_max_pct": 6},
    ]
    ways = finalize(req, raw)
    assert any(w.months is None or w.months > 180 for w in ways)  # the deposit alone would take decades
    compare_to_baseline(req, ways)
    kept = drop_pointless(req, ways)
    assert [w.title for w in kept] == ["ETF plan"]


# --- Login & persistence ---


def test_requires_login():
    with TestClient(create_app()) as client:
        assert client.get("/api/account/overview").status_code == 401
        assert client.get("/api/goals").status_code == 401
        bad = client.post("/api/auth/login", json={"username": "demo", "password": "nope"})
        assert bad.status_code == 401


def test_login_logout_and_goals_survive_logout():
    app = create_app()
    with TestClient(app) as client:
        r = client.post("/api/auth/login", json={"username": "Demo ", "password": "demo"})
        assert r.status_code == 200 and r.json()["name"] == "Vincenzo Amalfi"
        assert "duckbank_session" in client.cookies
        client.post("/api/goals", json={"name": "Oven", "target": 2000})
        assert client.post("/api/auth/logout").status_code == 204
        assert client.get("/api/me").status_code == 401

        client.post("/api/auth/login", json={"username": "demo", "password": "demo"})
        names = [g["name"] for g in client.get("/api/goals").json()]
        assert "Oven" in names  # stored in the database, not in the session


def test_demo_user_and_transactions_are_stored_in_database():
    from sqlalchemy import func, select

    from app.db import TransactionRow, UserRow, new_session

    with logged_in(create_app()):
        with new_session() as db:
            assert db.scalar(select(func.count()).select_from(UserRow)) == 1
            assert db.scalar(select(func.count()).select_from(TransactionRow)) == 1125
            user = db.scalar(select(UserRow))
            assert user.password_hash.startswith("pbkdf2_sha256$") and "demo" not in user.password_hash
