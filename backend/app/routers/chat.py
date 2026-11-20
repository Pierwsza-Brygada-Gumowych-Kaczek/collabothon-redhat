from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.schemas import ChatRequest, ChatResponse
from app.services.openshift_ai import OpenShiftAIClient, OpenShiftAIError

router = APIRouter(prefix="/api", tags=["chat"])


def get_ai(request: Request) -> OpenShiftAIClient:
    return request.app.state.ai


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, ai: OpenShiftAIClient = Depends(get_ai)) -> ChatResponse:
    try:
        message = await ai.chat(body.messages, body.max_tokens, body.temperature)
    except OpenShiftAIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return ChatResponse(message=message, model=ai.model)


@router.post("/chat/stream")
async def chat_stream(
    body: ChatRequest, ai: OpenShiftAIClient = Depends(get_ai)
) -> StreamingResponse:
    async def events():
        try:
            async for chunk in ai.chat_stream(body.messages, body.max_tokens, body.temperature):
                yield chunk
        except OpenShiftAIError as exc:
            yield f"\n[error: {exc}]"

    return StreamingResponse(events(), media_type="text/plain; charset=utf-8")
