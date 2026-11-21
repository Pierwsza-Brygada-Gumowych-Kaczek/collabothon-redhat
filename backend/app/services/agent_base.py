"""Shared plumbing for the AI CFO agents.

Every agent follows the same pattern:
1. compute hard facts deterministically from the bank statement (balances, forecast, tax
   figures, FX exposure) — these are numbers, not AI output,
2. send the facts to the model served by OpenShift AI, which writes the summary and the
   recommendations as strict JSON,
3. if the model cannot be reached or answers with invalid JSON, the agent returns the facts
   with an `error` and NO recommendations — there is no fallback / mock content.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from typing import TypeVar

from pydantic import ValidationError

from app.schemas import Message, TaxTip
from app.services.openshift_ai import OpenShiftAIClient, OpenShiftAIError

log = logging.getLogger(__name__)
T = TypeVar("T")

STYLE = (
    "Write in plain, short English for a small-business owner with no financial training. "
    "Avoid jargon. Use English only — do not use German terms; describe products and laws in English. "
    "Never promise returns; give cautious ranges. Do not invent laws or products."
)


class AgentUnavailable(Exception):
    """The agent could not produce recommendations; the message is shown to the user."""


def extract_json(text: str) -> dict:
    """Extract a JSON object from a model reply (tolerates ```json fences and surrounding text)."""
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in the reply")
    return json.loads(text[start : end + 1])


# A tax tip that saves less than this is noise ("up to EUR 0") and is not shown.
MIN_SAVING_EUR = 50


def worthwhile(tips: list[TaxTip]) -> list[TaxTip]:
    """Only tips that actually save money."""
    return [t for t in tips if t.saving_max_eur >= MIN_SAVING_EUR]


def num(v: object, default: float = 0.0) -> float:
    """Number from a model reply: accepts '10,000', '2.5%', ' 3 '."""
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d.\-]", "", str(v).replace(",", ""))
    try:
        return float(s)
    except ValueError:
        return default


def pick(v: object, allowed: dict[str, str], default: str) -> str:
    return allowed.get(str(v).strip().lower(), default)


def str_list(v: object) -> list[str]:
    if isinstance(v, list):
        return [str(x) for x in v]
    return [str(v)] if v else []


def eur(v: float) -> str:
    return f"-€{-v:,.0f}" if v < 0 else f"€{v:,.0f}"


async def run_agent(
    ai: OpenShiftAIClient,
    name: str,
    system_prompt: str,
    context: str,
    from_model: Callable[[dict], T],
    max_tokens: int = 1800,
) -> T:
    """Ask the model and parse its JSON. Raises AgentUnavailable with a user-facing reason."""
    messages = [
        Message(role="system", content=f"{system_prompt}\n\n{STYLE}"),
        Message(role="user", content=context),
    ]
    try:
        reply = await ai.chat(messages, max_tokens=max_tokens, temperature=0.2, json_mode=True)
    except OpenShiftAIError as exc:
        log.warning("%s agent: model unavailable: %s", name, exc)
        raise AgentUnavailable(str(exc)) from exc
    try:
        return from_model(extract_json(reply.content))
    except (ValueError, TypeError, KeyError, ValidationError) as exc:
        log.warning("%s agent: invalid model reply: %s | %.300s", name, exc, reply.content)
        raise AgentUnavailable(
            f"The model ({ai.model}) answered, but not in the expected JSON format: {str(exc).splitlines()[0]}"
        ) from exc
