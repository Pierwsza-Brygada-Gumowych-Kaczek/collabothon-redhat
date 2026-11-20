# Template: Angular + FastAPI + OpenShift AI na Kubernetes

```
backend/    FastAPI — proxy do modelu w OpenShift AI (API zgodne z OpenAI: KServe + vLLM)
frontend/   Angular 19 (standalone) + nginx (SPA + reverse proxy /api -> backend)
k8s/        Kustomize: base + overlay openshift (Route) + overlay kubernetes (Ingress)
```

Przepływ: `przeglądarka → nginx (frontend) → /api → FastAPI → InferenceService w OpenShift AI`.

## Konfiguracja backendu (zmienne środowiskowe)

| Zmienna | Opis |
|---|---|
| `OPENSHIFT_AI_URL` | URL modelu kończący się na `/v1` (w klastrze: `http://<model>-predictor.<ns>.svc.cluster.local:8080/v1`) |
| `OPENSHIFT_AI_MODEL` | nazwa modelu wysyłana w żądaniu |
| `OPENSHIFT_AI_TOKEN` | token Bearer (wymagany przy zewnętrznej routie z autoryzacją) |
| `OPENSHIFT_AI_VERIFY_SSL` / `OPENSHIFT_AI_CA_BUNDLE` | weryfikacja TLS / własny CA |

Endpointy: `POST /api/chat`, `POST /api/chat/stream`, `GET /healthz`, `GET /readyz` (sprawdza dostępność modelu).

## Lokalnie

```powershell
# backend
cd backend; python -m venv .venv; .venv\Scripts\activate
pip install -r requirements-dev.txt
copy .env.example .env      # uzupełnij URL modelu
uvicorn app.main:app --reload
pytest

# frontend (nowy terminal) — proxy /api -> localhost:8000
cd frontend; npm install; npm start
```

Lub całość: `docker compose up --build` → http://localhost:8080.

## Wdrożenie

```powershell
docker build -t quay.io/YOUR_ORG/ai-app-backend:latest backend
docker build -t quay.io/YOUR_ORG/ai-app-frontend:latest frontend
docker push quay.io/YOUR_ORG/ai-app-backend:latest
docker push quay.io/YOUR_ORG/ai-app-frontend:latest
```

1. Podmień obrazy w `k8s/base/kustomization.yaml` (`images:`) i adres modelu w `k8s/base/configmap.yaml`.
2. Token: `kubectl create secret generic backend-secret --from-literal=OPENSHIFT_AI_TOKEN=...` (usuń `secret.yaml` z base, jeśli zarządzasz sekretem osobno).
3. Zastosuj overlay:
   - OpenShift: `oc apply -k k8s/overlays/openshift -n <projekt>`
   - Zwykły Kubernetes: `kubectl apply -k k8s/overlays/kubernetes -n <namespace>`

Uwagi: obrazy działają jako non-root (zgodne z `restricted` SCC); frontend zakłada Service o nazwie `backend` w tym samym namespace (`frontend/nginx.conf`). Po pierwszym `npm install` zacommituj `package-lock.json` i zamień w Dockerfile frontendu `npm install` na `npm ci`.
