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

### Prototyp bankowy (dummy user)

Brak logowania — każdy odwiedzający widzi konto demo **Vincenzo Amalfi / Pizzeria Amalfi**.
Dane pochodzą z `backend/app/data/pizzeria-amalfi-bank-statement-2025-v6.csv` (raty w CHF przeliczane po kursie z opisu przelewu, saldo otwarcia `STATEMENT_OPENING_BALANCE=2500`).

| Endpoint | Opis |
|---|---|
| `GET /api/me` | dane dummy usera |
| `GET /api/account/overview` | saldo, KPI, saldo dzienne, podsumowanie miesięczne, kategorie wydatków |
| `GET /api/account/transactions?limit=&offset=&category=` | transakcje (najnowsze pierwsze, opcjonalny filtr kategorii) |
| `GET /api/budgets` | miesięczne budżety (limit, wydano, zostało, reset) |
| `GET /api/liquidity?days=90&include_tax=false` | **Liquidity agent** — prognoza salda N dni naprzód + propozycje linii kredytowych |
| `GET /api/insights` | **Investment agent** — lokaty, fundusze rynku pieniężnego, ETF, finansowanie capex |
| `GET /api/tax-tips` | **Tax agent** — harmonogram zaliczek podatkowych + legalna optymalizacja |
| `GET /api/fx` | **FX hedging agent** — ryzyko walutowe (CHF) + zabezpieczenia produktami Commerzbanku |
| `GET /api/ai/status` | czy model OpenShift AI jest skonfigurowany, osiągalny i serwuje `OPENSHIFT_AI_MODEL` |

Każdy agent: **fakty** (saldo, prognoza, kwoty podatków, ekspozycja CHF) liczone deterministycznie z wyciągu → **rekomendacje** pisze wyłącznie model w OpenShift AI (JSON). Gdy modelu nie ma albo zwróci niepoprawny JSON: przy `AGENTS_DEMO_FALLBACK=true` (domyślnie, na czas developmentu) agenci zwracają rekomendacje demo z reguł (`source: "demo"`, wyraźnie oznaczone w UI); przy `false` — `source: "unavailable"` i `error`, a strona pokazuje błąd. Udane odpowiedzi są cache'owane (`?refresh=true` liczy od nowa), błędy nie. UI aplikacji jest po angielsku.

Podłączenie modelu: uzupełnij `OPENSHIFT_AI_URL`, `OPENSHIFT_AI_MODEL`, `OPENSHIFT_AI_TOKEN` w `backend/.env` (opis w `.env.example`), zrestartuj backend i sprawdź `GET /api/ai/status` (w UI: znacznik „AI connected / AI offline” w nagłówku).

## Konfiguracja

Wszystkie ustawienia backendu są w `backend/.env` (pełna lista kluczy: `backend/.env.example`, kod: `backend/app/config.py`). Zmienne środowiskowe (docker compose, ConfigMap/Secret w Kubernetes) mają pierwszeństwo przed `.env`. Dane logowania do PostgreSQL dla docker compose: `.env` w katalogu głównym (wzór: `.env.example`, domyślnie `duckbank`/`duckbank`).

Baza danych przechowuje użytkowników, sesje logowania, transakcje i budżety. Przy pierwszym starcie backend tworzy tabele i konto **demo / demo** z zaimportowanym wyciągiem.

## Lokalnie (bez Dockera, SQLite)

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

## Docker Desktop — docker compose (PostgreSQL + backend + frontend)

```powershell
copy .env.example .env            # opcjonalnie: hasło do bazy
copy backend\.env.example backend\.env
docker compose up --build         # -> http://localhost:8080  (demo / demo)
docker compose down               # stop (dane zostają w wolumenie pgdata)
docker compose down -v            # stop + skasowanie bazy
```

Backend uruchomiony poza Dockerem może korzystać z tej samej bazy: `DATABASE_URL=postgresql+psycopg://duckbank:duckbank@localhost:5432/duckbank`.

## Docker Desktop — Kubernetes

Włącz Kubernetes w Docker Desktop (Settings → Kubernetes), potem:

```powershell
docker build -t duckbank-backend:dev backend
docker build -t duckbank-frontend:dev frontend
kubectl create namespace duckbank
kubectl apply -k k8s/overlays/docker-desktop -n duckbank
kubectl get pods -n duckbank -w     # poczekaj aż postgres, backend, frontend będą Running
```

Aplikacja: http://localhost:8080 (Service frontendu typu LoadBalancer). Usunięcie: `kubectl delete namespace duckbank`.

## Wdrożenie (OpenShift / Kubernetes)

```powershell
docker build -t quay.io/YOUR_ORG/ai-app-backend:latest backend
docker build -t quay.io/YOUR_ORG/ai-app-frontend:latest frontend
docker push quay.io/YOUR_ORG/ai-app-backend:latest
docker push quay.io/YOUR_ORG/ai-app-frontend:latest
```

1. Podmień obrazy w `k8s/base/kustomization.yaml` (`images:`) i adres modelu w `k8s/base/configmap.yaml`.
2. Zmień hasło bazy w `k8s/base/secret.yaml` (w `postgres-credentials` **i** w `DATABASE_URL` w `backend-secret`) albo utwórz sekrety ręcznie (polecenia w komentarzu pliku) i usuń `secret.yaml` z `kustomization.yaml`.
3. Zastosuj overlay:
   - OpenShift: `oc apply -k k8s/overlays/openshift -n <projekt>` (ustawia `COOKIE_SECURE=true` dla HTTPS Route)
   - Zwykły Kubernetes: `kubectl apply -k k8s/overlays/kubernetes -n <namespace>`

`k8s/base` zawiera PostgreSQL 16 (`postgres.yaml`: Deployment z 1 repliką, PVC 1Gi na dane, Service `postgres`). Obraz `quay.io/sclorg/postgresql-16-c9s` działa jako non-root, więc pasuje do `restricted` SCC w OpenShift. Backend przy starcie czeka na bazę (`DB_CONNECT_RETRIES`), więc kolejność uruchamiania podów nie ma znaczenia.

Uwagi: obrazy działają jako non-root (zgodne z `restricted` SCC); frontend zakłada Service o nazwie `backend` w tym samym namespace (`frontend/nginx.conf`).
