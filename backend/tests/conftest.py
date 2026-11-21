"""Tests talk to a mocked model at localhost:8080 and use a fresh SQLite database per test,
independent of the developer's .env."""

import os
from contextlib import contextmanager

os.environ.update(
    OPENSHIFT_AI_URL="http://localhost:8080/v1",
    OPENSHIFT_AI_MODEL="granite",
    OPENSHIFT_AI_TOKEN="",
    OPENSHIFT_AI_JSON_MODE="true",
    AGENTS_DEMO_FALLBACK="false",  # error mode by default; demo mode is tested explicitly
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402

get_settings.cache_clear()


@pytest.fixture(autouse=True)
def fresh_database(tmp_path, monkeypatch):
    """Every test starts with an empty database (demo user is re-seeded on app start)."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@contextmanager
def logged_in(app, username: str = "demo", password: str = "demo"):
    """TestClient already logged in (session cookie set)."""
    with TestClient(app) as client:
        r = client.post("/api/auth/login", json={"username": username, "password": password})
        assert r.status_code == 200, r.text
        yield client
