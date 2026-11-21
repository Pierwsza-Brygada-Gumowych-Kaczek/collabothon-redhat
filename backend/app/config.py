"""Application settings — every value can be set in backend/.env (or as an environment variable).

Precedence (highest first): real environment variables (Kubernetes ConfigMap / Secret, docker
compose `environment:`), then backend/.env, then the defaults below. The defaults only make a
fresh checkout start locally; backend/.env.example lists every key.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # backend/.env is found no matter which folder the server is started from.
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    # --- General ---
    app_name: str = "Duck CFO API"
    log_level: str = "INFO"
    cors_origins: list[str] = ["http://localhost:4200"]

    # --- OpenShift AI (KServe / vLLM, OpenAI-compatible API) ---
    # Base URL ending in /v1, e.g.:
    #   in-cluster: http://<model>-predictor.<namespace>.svc.cluster.local:8080/v1
    #   external:  https://<model>-<namespace>.apps.<cluster-domain>/v1
    openshift_ai_url: str = "http://localhost:8080/v1"
    openshift_ai_model: str = "granite"
    # Bearer token (ServiceAccount / model route token). Empty = no auth.
    openshift_ai_token: str = ""
    openshift_ai_verify_ssl: bool = True
    # Optional path to a custom CA (e.g. OpenShift service-ca).
    openshift_ai_ca_bundle: str | None = None
    openshift_ai_timeout: float = 90.0
    # Ask vLLM for strict JSON output (response_format=json_object). Disable if the server rejects it.
    openshift_ai_json_mode: bool = True
    # While the model is not connected, show rule-based demo recommendations (labelled "demo")
    # instead of an error. Set to false once OpenShift AI is connected.
    agents_demo_fallback: bool = True

    # --- Database ---
    # SQLite file for quick local runs; PostgreSQL for docker compose / Kubernetes, e.g.
    # postgresql+psycopg://duckbank:duckbank@postgres:5432/duckbank
    database_url: str = "sqlite:///" + (BACKEND_DIR / "data" / "duckbank.db").as_posix()
    # How long to wait for the database at start-up (it may still be booting in a container).
    db_connect_retries: int = 30
    db_connect_retry_seconds: float = 2.0

    # --- Login ---
    session_days: int = 7
    # Send the session cookie only over HTTPS (true behind the OpenShift Route / Ingress with TLS).
    cookie_secure: bool = False

    # --- Demo account (created on first start, with the sample bank statement imported) ---
    demo_username: str = "demo"
    demo_password: str = "demo"
    demo_name: str = "Vincenzo Amalfi"
    demo_business: str = "Pizzeria Amalfi"
    demo_email: str = "vincenzo@pizzeria-amalfi.example"
    demo_segment: str = "Business client · SME"
    statement_csv_path: str = str(Path(__file__).resolve().parent / "data" / "pizzeria-amalfi-bank-statement-2025-v6.csv")
    # Balance on 1 Jan 2025 (before the first transaction in the file).
    statement_opening_balance: float = 2500.0

    # Relative paths in .env are relative to the backend/ folder, wherever the server is started.
    @field_validator("statement_csv_path")
    @classmethod
    def _abs_csv(cls, v: str) -> str:
        p = Path(v)
        return str(p if p.is_absolute() else BACKEND_DIR / p)

    @field_validator("database_url")
    @classmethod
    def _abs_sqlite(cls, v: str) -> str:
        prefix = "sqlite:///"
        if v.startswith(prefix) and not v.startswith(prefix + "/") and not Path(v[len(prefix):]).is_absolute():
            return prefix + (BACKEND_DIR / v[len(prefix):]).as_posix()
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
