"""Client for the model served by OpenShift AI (KServe + vLLM, OpenAI-compatible API)."""

from collections.abc import AsyncIterator
import json

import httpx

from app.config import Settings
from app.schemas import Message


class OpenShiftAIError(Exception):
    """The model served by OpenShift AI could not be used. The message is safe to show to users."""


class OpenShiftAIClient:
    def __init__(self, settings: Settings) -> None:
        self._model = settings.openshift_ai_model
        self._url = settings.openshift_ai_url.rstrip("/")
        self._json_mode = settings.openshift_ai_json_mode
        headers = {"Content-Type": "application/json"}
        if settings.openshift_ai_token:
            headers["Authorization"] = f"Bearer {settings.openshift_ai_token}"

        verify: bool | str = settings.openshift_ai_verify_ssl
        if verify and settings.openshift_ai_ca_bundle:
            verify = settings.openshift_ai_ca_bundle

        self._http = httpx.AsyncClient(
            base_url=self._url or "http://unconfigured.invalid",
            headers=headers,
            verify=verify,
            # Short connect timeout: an unreachable model falls back to demo content within seconds,
            # while a reachable one still gets the full time to answer.
            timeout=httpx.Timeout(settings.openshift_ai_timeout, connect=min(5.0, settings.openshift_ai_timeout)),
        )

    @property
    def model(self) -> str:
        return self._model

    @property
    def url(self) -> str:
        return self._url

    @property
    def configured(self) -> bool:
        return bool(self._url and self._model)

    async def aclose(self) -> None:
        await self._http.aclose()

    def _payload(
        self, messages: list[Message], max_tokens: int, temperature: float, stream: bool, json_mode: bool
    ) -> dict:
        payload = {
            "model": self._model,
            "messages": [m.model_dump() for m in messages],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": stream,
        }
        if json_mode and self._json_mode:
            payload["response_format"] = {"type": "json_object"}
        return payload

    def _explain(self, exc: Exception) -> OpenShiftAIError:
        """Turn low-level errors into a message that tells the user what to fix."""
        if isinstance(exc, httpx.HTTPStatusError):
            code = exc.response.status_code
            hint = {
                400: "the model rejected the request (check OPENSHIFT_AI_MODEL; set OPENSHIFT_AI_JSON_MODE=false if JSON mode is unsupported)",
                401: "the model rejected the token (check OPENSHIFT_AI_TOKEN)",
                403: "the token has no access to this model (check OPENSHIFT_AI_TOKEN / RBAC)",
                404: "endpoint or model not found (OPENSHIFT_AI_URL must end with /v1; check OPENSHIFT_AI_MODEL)",
            }.get(code, "the model server returned an error")
            return OpenShiftAIError(f"HTTP {code} from {self._url}: {hint}.")
        if isinstance(exc, httpx.TimeoutException):
            return OpenShiftAIError(
                f"The model at {self._url} did not answer in time (raise OPENSHIFT_AI_TIMEOUT or check the deployment)."
            )
        if isinstance(exc, httpx.ConnectError) and "CERTIFICATE" in str(exc).upper():
            return OpenShiftAIError(
                f"TLS certificate of {self._url} is not trusted (set OPENSHIFT_AI_CA_BUNDLE or OPENSHIFT_AI_VERIFY_SSL=false)."
            )
        if isinstance(exc, httpx.HTTPError):
            return OpenShiftAIError(f"Cannot connect to the model at {self._url} ({type(exc).__name__}).")
        return OpenShiftAIError(f"Unexpected response from the model at {self._url}.")

    def _require_config(self) -> None:
        if not self.configured:
            raise OpenShiftAIError(
                "OpenShift AI is not configured — set OPENSHIFT_AI_URL and OPENSHIFT_AI_MODEL in backend/.env."
            )

    async def chat(
        self,
        messages: list[Message],
        max_tokens: int = 512,
        temperature: float = 0.7,
        json_mode: bool = False,
    ) -> Message:
        self._require_config()
        try:
            resp = await self._http.post(
                "/chat/completions",
                json=self._payload(messages, max_tokens, temperature, stream=False, json_mode=json_mode),
            )
            resp.raise_for_status()
            choice = resp.json()["choices"][0]["message"]
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            raise self._explain(exc) from exc
        return Message(role="assistant", content=choice.get("content") or "")

    async def chat_stream(
        self, messages: list[Message], max_tokens: int = 512, temperature: float = 0.7
    ) -> AsyncIterator[str]:
        """Yields text chunks of the answer (SSE from vLLM)."""
        self._require_config()
        try:
            async with self._http.stream(
                "POST",
                "/chat/completions",
                json=self._payload(messages, max_tokens, temperature, stream=True, json_mode=False),
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line.removeprefix("data:").strip()
                    if data == "[DONE]":
                        break
                    delta = json.loads(data)["choices"][0].get("delta", {})
                    if text := delta.get("content"):
                        yield text
        except httpx.HTTPError as exc:
            raise self._explain(exc) from exc

    async def status(self) -> dict:
        """Connection check used by /api/ai/status: is the server reachable and is the model there?"""
        result = {"configured": self.configured, "url": self._url, "model": self._model,
                  "reachable": False, "model_found": False, "available_models": [], "error": None}
        if not self.configured:
            result["error"] = "OpenShift AI is not configured — set OPENSHIFT_AI_URL and OPENSHIFT_AI_MODEL in backend/.env."
            return result
        try:
            resp = await self._http.get("/models", timeout=10.0)
            resp.raise_for_status()
            ids = [m.get("id") for m in resp.json().get("data", []) if isinstance(m, dict)]
            result.update(reachable=True, available_models=ids, model_found=self._model in ids)
            if not result["model_found"]:
                result["error"] = (
                    f"Model '{self._model}' is not served at {self._url}. "
                    f"Available: {', '.join(ids) or 'none'} — set OPENSHIFT_AI_MODEL accordingly."
                )
        except (httpx.HTTPError, ValueError) as exc:
            result["error"] = str(self._explain(exc))
        return result

    async def is_reachable(self) -> bool:
        return (await self.status())["reachable"]
