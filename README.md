# Supply Chain Risk MVP

Local application that maps a supply chain, detects commodity risk events, assesses business impact and records a response, for wheat and tungsten. Everything runs locally in Docker.

Status: frontend prototype of nine screens on mock data; Docker stack with database, API skeleton and web server. The API does not serve business data yet.

## Layout

| Path | Content |
| --- | --- |
| `frontend/` | React, TypeScript and Vite app (nine screens, mock data) |
| `backend/` | FastAPI application (health endpoints so far) |
| `db/` | PostgreSQL 16 with PostGIS, built on an arm64-capable base image |
| `docker-compose.yml` | The stack: `db`, `api`, `web` |
| `.env.example` | Settings template; copy to `.env` |

## Run the stack

```
cp .env.example .env        # then set POSTGRES_PASSWORD
docker compose up -d --build
```

| Service | URL on this machine |
| --- | --- |
| Web app (frontend and `/api`) | http://127.0.0.1:8095 |
| API directly, with docs | http://127.0.0.1:8100/api/docs |
| PostgreSQL | `127.0.0.1:5442` |

Host ports avoid other projects on the same machine; change them in `.env`.

Checks:

```
curl http://127.0.0.1:8095/api/health
curl http://127.0.0.1:8095/api/health/db
curl http://127.0.0.1:8095/api/health/keycloak
```

Stop with `docker compose down`. Add `-v` to also delete the database volume.

## Frontend development

```
cd frontend
npm install
npm run dev        # http://127.0.0.1:5180
```

The prototype uses a development identity switch in the top bar. Data is in memory and resets on reload.

## Backend tests

```
docker compose run --rm --no-deps --entrypoint "" -v "$PWD/backend:/srv" -w /srv api \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q"
```

## Identity

Login will use an existing Keycloak instance in the local Kubernetes cluster (namespace `citizen`), with a separate realm for this project. Reach it with:

```
kubectl -n citizen port-forward svc/keycloak 8180:8080
```

Containers reach the forwarded port through `host.docker.internal`. Settings are in `.env`. `/api/health/keycloak` reports whether the realm is reachable.

## Notes

- All bundled data is synthetic and labelled simulated.
- Client and planning documents are kept out of this repository.
