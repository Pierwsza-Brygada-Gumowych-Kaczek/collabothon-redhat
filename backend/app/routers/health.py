from fastapi import APIRouter, Request, Response, status

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def liveness() -> dict[str, str]:
    """Liveness probe — the process is alive."""
    return {"status": "ok"}


@router.get("/readyz")
async def readiness(request: Request, response: Response) -> dict[str, str]:
    """Readiness probe — the app is ready and the OpenShift AI model responds."""
    if await request.app.state.ai.is_reachable():
        return {"status": "ready"}
    response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "model unreachable"}
