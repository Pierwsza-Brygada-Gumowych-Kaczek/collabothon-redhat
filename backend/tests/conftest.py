"""Tests always talk to a mocked model at localhost:8080, independent of the developer's .env."""

import os

os.environ.update(
    OPENSHIFT_AI_URL="http://localhost:8080/v1",
    OPENSHIFT_AI_MODEL="granite",
    OPENSHIFT_AI_TOKEN="",
    OPENSHIFT_AI_JSON_MODE="true",
    AGENTS_DEMO_FALLBACK="false",  # error mode by default; demo mode is tested explicitly
)

from app.config import get_settings  # noqa: E402

get_settings.cache_clear()
