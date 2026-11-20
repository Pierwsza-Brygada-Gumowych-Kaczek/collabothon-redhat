import json
from datetime import date

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.main import create_app
from app.routers.account import get_today

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
    with TestClient(create_app()) as client:
        assert client.get("/api/me").json()["name"] == "Vincenzo Amalfi"


def test_overview_matches_sample_data():
    with TestClient(create_app()) as client:
        ov = client.get("/api/account/overview").json()
    assert round(ov["balance"], 0) == 33266  # closing balance from the scenario sheet
    assert ov["kpis"]["min_balance"] < -20000  # dip after the June shutdown
    assert ov["kpis"]["swiss_transfers_count"] == 12
    assert [m["label"] for m in ov["monthly"]][:2] == ["Jan", "Feb"]


def test_transactions_newest_first_and_filter():
    with TestClient(create_app()) as client:
        page = client.get("/api/account/transactions?limit=5").json()
        rent = client.get("/api/account/transactions?category=Rent").json()
    assert page["total"] == 1125
    assert page["items"][0]["date"] == "2025-12-31"
    assert rent["total"] == 12


def test_budgets_progress_and_reset():
    app = create_app()
    app.dependency_overrides[get_today] = lambda: date(2026, 11, 20)
    with TestClient(app) as client:
        budgets = {b["id"]: b for b in client.get("/api/budgets").json()}
    assert set(budgets) == {"food", "beverages", "utilities", "rent"}
    rent = budgets["rent"]
    assert rent["spent"] == 3800  # rent is debited on the 1st
    assert rent["remaining"] == rent["limit"] - 3800
    assert rent["reset_date"] == "2026-12-01"
    assert rent["reset_in_days"] == 11


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
    with TestClient(create_app()) as client:
        r = client.get("/api/insights?refresh=true").json()
    p = r["proposals"][0]
    assert r["source"] == "openshift-ai" and r["error"] is None
    assert (p["amount_eur"], p["risk"], p["contribution"], p["horizon_months"]) == (10000, "low", "monthly", 6)
    assert (p["return_min_pct"], p["return_max_pct"]) == (2, 3)
    assert r["proposals"][1]["kind"] == "financing"
    sent = json.loads(route.calls.last.request.content)
    assert sent["response_format"] == {"type": "json_object"}  # JSON mode on by default


def test_insights_without_model_returns_error_and_no_proposals(model_down):
    with TestClient(create_app()) as client:
        r = client.get("/api/insights?refresh=true").json()
    assert r["source"] == "unavailable"
    assert "Cannot connect" in r["error"]
    assert r["proposals"] == [] and r["summary"] == ""


@respx.mock
def test_invalid_model_json_is_an_error_not_cached():
    route = respx.post(f"{MODEL_URL}/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "Sorry, I cannot help."}}]})
    )
    with TestClient(create_app()) as client:
        first = client.get("/api/insights").json()
        client.get("/api/insights")
    assert first["source"] == "unavailable" and "JSON" in first["error"]
    assert route.call_count == 2  # failures are not cached, the next request retries


@respx.mock
def test_model_auth_error_is_explained():
    respx.post(f"{MODEL_URL}/chat/completions").mock(return_value=httpx.Response(401))
    with TestClient(create_app()) as client:
        r = client.get("/api/insights?refresh=true").json()
    assert "OPENSHIFT_AI_TOKEN" in r["error"]


# --- Tax agent ---


def test_income_tax_formula_known_points():
    from app.services.tax import income_tax_2025

    assert income_tax_2025(12_096) == 0
    assert round(income_tax_2025(100_000)) == 31_088  # 0.42 * 100,000 - 10,911.92


def test_tax_without_model_keeps_facts_and_schedule_but_no_tips(model_down):
    with TestClient(create_app()) as client:
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
    with TestClient(create_app()) as client:
        r = client.get("/api/tax-tips?refresh=true").json()
    t = r["tips"][0]
    assert r["source"] == "openshift-ai" and r["schedule"]
    assert (t["saving_min_eur"], t["saving_max_eur"], t["difficulty"], t["steps"]) == (2000, 5000, "hard", ["one step"])


# --- Liquidity agent ---


def test_liquidity_forecast_is_calculated_even_without_model(model_down):
    with TestClient(create_app()) as client:
        r = client.get("/api/liquidity?days=90&refresh=true").json()
        r_tax = client.get("/api/liquidity?days=180&include_tax=true&refresh=true").json()
    assert r["error"] and r["facilities"] == [] and r["summary"] == ""
    assert r["as_of"] == "2025-12-31" and len(r["forecast"]) == 90
    assert r["forecast"][0]["date"] == "2026-01-01"
    assert any(s["label"] == "Rent" and s["date"] == "2026-01-01" for s in r["scheduled"])
    assert not any("Swiss" in s["label"] for s in r["scheduled"])  # instalments have ended
    assert r["overdraft_cost_last_year"] > 0
    assert r_tax["min_balance"] < r["min_balance"]  # the tax back-payment makes it worse
    assert any("back-payment" in s["label"] for s in r_tax["scheduled"])


@respx.mock
def test_liquidity_facilities_from_model():
    content = {"summary": "Tight in June.", "facilities": [
        {"title": "Credit line", "product": "Business credit line", "limit_eur": "30,000",
         "interest_min_pct": 11, "interest_max_pct": 8, "steps": ["apply"]}]}
    respx.post(f"{MODEL_URL}/chat/completions").mock(return_value=model_reply(content))
    with TestClient(create_app()) as client:
        r = client.get("/api/liquidity?days=180&refresh=true").json()
    f = r["facilities"][0]
    assert r["source"] == "openshift-ai" and r["summary"] == "Tight in June."
    assert (f["limit_eur"], f["interest_min_pct"], f["interest_max_pct"]) == (30000, 8, 11)
    assert len(r["forecast"]) == 180


# --- FX agent ---


def test_fx_exposure_calculated_without_model(model_down):
    with TestClient(create_app()) as client:
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
    with TestClient(create_app()) as client:
        r = client.get("/api/fx?refresh=true").json()
    assert r["risk_level"] == "high" and r["hedges"][0]["notional"] == 25000


# --- AI status ---


@respx.mock
def test_ai_status_reports_missing_model():
    respx.get(f"{MODEL_URL}/models").mock(
        return_value=httpx.Response(200, json={"data": [{"id": "llama-3"}]})
    )
    with TestClient(create_app()) as client:
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
    with TestClient(create_app()) as client:
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
