from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration from environment variables (ConfigMap / Secret in Kubernetes)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "OpenShift AI App"
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

    # --- Demo data (bank statement of the dummy user) ---
    statement_csv_path: str = str(
        Path(__file__).parent / "data" / "pizzeria-amalfi-bank-statement-2025-v6.csv"
    )
    # Balance on 1 Jan 2025 (before the first transaction in the file).
    statement_opening_balance: float = 2500.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
