import httpx
import respx
from fastapi.testclient import TestClient

from app.main import create_app

MODEL_URL = "http://localhost:8080/v1"


def test_healthz():
    with TestClient(create_app()) as client:
        assert client.get("/healthz").json() == {"status": "ok"}


@respx.mock
def test_chat_proxies_to_model():
    respx.post(f"{MODEL_URL}/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"role": "assistant", "content": "Cześć!"}}]}
        )
    )
    with TestClient(create_app()) as client:
        r = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hej"}]})
    assert r.status_code == 200
    assert r.json()["message"]["content"] == "Cześć!"


@respx.mock
def test_chat_model_error_gives_502():
    respx.post(f"{MODEL_URL}/chat/completions").mock(return_value=httpx.Response(500))
    with TestClient(create_app()) as client:
        r = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hej"}]})
    assert r.status_code == 502


@respx.mock
def test_readyz_503_when_model_down():
    respx.get(f"{MODEL_URL}/models").mock(side_effect=httpx.ConnectError("down"))
    with TestClient(create_app()) as client:
        assert client.get("/readyz").status_code == 503
