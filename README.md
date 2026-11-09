# Supply Chain Risk MVP

Local application that maps a supply chain, detects commodity risk events, assesses business impact and records a response, for wheat and tungsten. Everything runs locally in Docker.

Status: frontend prototype of nine screens on mock data; Docker stack with database, schema, demo data and an API skeleton. The API serves alerts, network traversal and assessments ; screens S01 to S06 use it, S07 to S09 still use mock data. Writes need an identity (development headers for now).

## Layout

| Path | Content |
| --- | --- |
| `frontend/` | React, TypeScript and Vite app (nine screens, mock data) |
| `backend/` | FastAPI application, database models, Alembic migrations, demo seed and tests |
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

## Database

```
docker compose exec api alembic upgrade head     # create or update the schema
docker compose exec api python -m app.seed       # load the demo data (safe to repeat)
docker compose exec api python -m app.seed --reset   # empty the seeded tables and reload
```

The schema is in `backend/app/models.py` and `backend/alembic/versions/`. Rules enforced by the database itself: an assumption cannot be decided by its proposer, one active assumption per alert, one published and one draft version per rule, actions point at an existing assessment snapshot, and audit events cannot be changed or deleted.

The demo data is `backend/seed/demo.json`, generated from the frontend demo data:

```
cd frontend && npm run seed:export
```

After changing models: `docker compose run --rm -u root -v "$PWD/backend:/srv" -w /srv api alembic revision --autogenerate -m "describe change"`, then review the generated file. `alembic check` reports drift between models and migrations.

## API

Interactive docs at http://127.0.0.1:8100/api/docs. Field names are camelCase, matching the frontend types. Read endpoints are open. Write endpoints need a signed-in role; until Keycloak is connected the caller is identified by `X-Actor-Id`, `X-Actor-Name` and `X-Actor-Role` headers (`AUTH_MODE=dev`, local development only).

| Endpoint | Returns |
| --- | --- |
| `GET /api/alerts` | Alerts; filters `commodity`, `severity`, `mode`, `disposition` |
| `GET /api/alerts/{id}` | One alert with evidence, rule version, matched nodes, exposure and days of cover |
| `GET /api/alerts/{id}/assessment` | Latest assessment snapshot with calculated measures, active assumption, reference option and version history. Measures that need an approved assumption are null, with the reason |
| `POST /api/alerts/{id}/disposition` | Confirm, monitor or dismiss an alert. Analyst role; rationale required; writes an audit event |
| `POST /api/alerts/{id}/assumptions` | Propose a disruption assumption (Analyst). Replaces the current one; figures stay unavailable until approved |
| `POST /api/assumptions/{id}/decision` | Approve or reject (a different Analyst than the proposer). Approval creates a new assessment snapshot |
| `GET /api/alerts/{id}/options` | Response options: eligible ones ranked by gap, then cost; inventory listed apart; ineligible ones with the reasons |
| `POST /api/options/{id}/shortlist` | Shortlist or remove an option (Analyst, Manager); shared |
| `POST /api/options/{id}/decision` | Record the chosen option as an action with owner and target date (Manager). Only eligible options |
| `GET /api/actions`, `GET /api/actions/{id}` | Actions with overdue and review-needed flags; detail adds history and audit trail |
| `POST /api/actions/{id}/status` | Change status. Manager: any; owner or Admin: in progress or in review |
| `POST /api/actions/{id}/reassign` | Change the owner (Manager) |
| `GET /api/overview?commodity=` | Counts, action totals, last assessment, 7-day trend and source freshness for the overview screen |
| `GET /api/sources` | Sources with freshness state (fresh, stale, failing, paused) |
| `GET /api/network/nodes` | Network nodes; filter `commodity` |
| `GET /api/network/traverse` | Upstream and/or downstream suppliers from `focus`, bounded by `depth` (1 to 5) and `limit`, with `direction`, `material` filter, `truncated` flag and `cycleEdgeIds` |

Traversal runs as a recursive query in PostgreSQL. Calculations are in `backend/app/calc.py` (Decimal, with the wheat worked example as a test).

## Backend tests

The tests create a throwaway database on the stack's PostgreSQL server, so the stack must be running.

```
docker compose run --rm --no-deps -u root -v "$PWD/backend:/srv" -w /srv api \
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
