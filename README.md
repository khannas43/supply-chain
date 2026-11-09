# Supply Chain Risk MVP

Local application that maps a supply chain, detects commodity risk events, assesses business impact and records a response, for wheat and tungsten. Everything runs locally in Docker.

Status: nine screens on the API; ingestion path (collect, worker, rules, alerts) working with the simulator; Docker stack with database, schema, demo data, API and worker. The API serves alerts, network traversal and assessments ; all nine screens use it. Writes need an identity (development headers for now).

## Layout

| Path | Content |
| --- | --- |
| `frontend/` | React, TypeScript and Vite app (nine screens, mock data) |
| `backend/` | FastAPI application, database models, Alembic migrations, demo seed and tests |
| `db/` | PostgreSQL 16 with PostGIS, built on an arm64-capable base image |
| `docker-compose.yml` | The stack: `db`, `api`, `worker`, `web`, the `evidence` volume, and an optional `keycloak` |
| `keycloak/` | The `supplychain` realm (roles, clients, seed users) and `setup.py` to install it in any Keycloak |
| `e2e/` | Browser checks (Playwright) for sign-in, roles and screens |
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

The top bar has a development identity switch (replaced by Keycloak). `?as=u-demo` in the URL opens the app as that identity, for example `/simulator?as=u-demo`; ids are in `frontend/src/auth/users.ts`.

## Database

```
docker compose exec api alembic upgrade head     # create or update the schema
docker compose exec api python -m app.seed       # load the demo data (safe to repeat)
docker compose exec api python -m app.seed --reset   # empty the seeded tables and everything the app created, then reload
```

The schema is in `backend/app/models.py` and `backend/alembic/versions/`. Rules enforced by the database itself: an assumption cannot be decided by its proposer, one active assumption per alert, one published and one draft version per rule, actions point at an existing assessment snapshot, and audit events cannot be changed or deleted.

The demo data is `backend/seed/demo.json`, generated from the demo data files in `frontend/src/data` (the application itself reads only from the API):

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
| `POST /api/sources/{id}/enabled` | Pause or enable a source (Admin) |
| `GET /api/runs`, `GET /api/quarantine`, `GET /api/dead-letter`, `GET /api/pipeline/queue` | Ingestion runs, quarantined records, dead-letter records, queue status (Kafka and NiFi report "not connected") |
| `POST /api/quarantine/{id}/replay` | Save a corrected value and request a replay (Steward, Admin) |
| `GET /api/rules`, `POST /api/rules/{id}/draft`, `POST /api/rules/{id}/versions/{v}/publish` | Risk rule versions; draft thresholds, then publish (Analyst, Admin). Published versions are never edited |
| `GET /api/assumptions` | The assumptions library |
| `GET /api/reference`, `POST /api/reference/conversions` | Countries, aliases, forms and dated conversions; add a conversion (Steward, Admin) |
| `GET /api/imports/datasets`, `GET /api/imports`, `POST /api/imports/validate`, `POST /api/imports` | CSV imports: dry run (Analyst, Steward, Admin) and commit (Steward, Admin). Supplier network rows are applied to the network; the other datasets are validated and recorded. Rejected rows go to quarantine; the same file cannot be imported twice |
| `GET /api/simulator/scenarios`, `GET /api/simulator/run`, `POST /api/simulator/runs`, `POST /api/simulator/run/{pause,resume,advance,inject,reset}` | Simulator (Admin, Demo Operator): one run at a time, virtual clock, failure injection that shows up in source health |
| `GET /api/overview?commodity=` | Counts, action totals, last assessment, 7-day trend and source freshness for the overview screen |
| `GET /api/sources` | Sources with freshness state (fresh, stale, failing, paused) |
| `GET /api/network/nodes` | Network nodes; filter `commodity` |
| `GET /api/network/traverse` | Upstream and/or downstream suppliers from `focus`, bounded by `depth` (1 to 5) and `limit`, with `direction`, `material` filter, `truncated` flag and `cycleEdgeIds` |

Traversal runs as a recursive query in PostgreSQL. Calculations are in `backend/app/calc.py` (Decimal, with the wheat worked example as a test).

## How data flows

```
simulator / source  ->  collect  ->  evidence + outbox  ->  worker  ->  observation  ->  rules  ->  alert
(provider-shaped        (store the    (original kept,       (parse, map,   (validated,    (published   (exposure
 JSON payloads)          bytes)        message queued)       validate,      deduplicated)  version)     matched,
                                                             dedupe)                                    trail kept)
```

- **Collect** (`app/collect.py`) stores the original payload in the evidence store, records where it came from and queues one message. It is the job NiFi will do. Collecting the same bytes from a source twice records a duplicate and stops.
- **Evidence** is kept in the `evidence` Docker volume behind a small interface (`app/storage.py`), so an S3-compatible store can replace it. Objects are immutable and checksummed. Analysts, managers, stewards and admins can open the original from the evidence drawer (`GET /api/evidence/{id}/raw`).
- **Worker** (`app/worker.py`, the `worker` service) takes messages from the database outbox, one transaction each, with retries and backoff. Messages it cannot process go to the dead-letter list. Processing is idempotent, so a retry never raises a second alert. Kafka can replace the outbox transport later without changing either side.
- **Validation** quarantines a record with its reason and location instead of guessing: invalid JSON, a missing or invalid field, an unknown country, a record ID resent with different content. One bad record does not block the good ones beside it.
- **Rules** (`app/alerting.py`) use the *published* version of each rule; a draft never applies, and the alert records the version that raised it. Repeats of the same event within a scenario run join the existing alert. Late records are kept as history and change nothing.
- **Replay** of a quarantined record applies the steward's corrected value to the original record and runs it through the same pipeline. It resolves the item, or returns it to quarantine with the new reason.
- A new alert is shown as *partial* (exposed suppliers found, no consequence data) or *unassessed* (nothing matched). It has no assessment until inventory, demand and price data exist; it is never presented as zero exposure.

Not built yet: NiFi and Kafka, a mapping editor (mappings are versioned in code), live source connectors, and treating a stale source as stale input to the rules (the meaning needs agreeing first).

Watch the worker with `docker compose logs -f worker`.

## Backend tests

The tests create a throwaway database on the stack's PostgreSQL server, so the stack must be running.

```
docker compose run --rm --no-deps -u root -v "$PWD/backend:/srv" -w /srv api \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q"
```

## Sign-in

Two modes, set by `AUTH_MODE` in `.env`:

- **`dev`** (default): the top bar has an identity switch (`/simulator?as=u-demo` opens the app as that identity). The API trusts identity headers in this mode, so it is for local development only and must never face a network.
- **`keycloak`**: the browser signs in with Authorization Code and PKCE. The API accepts only a valid access token on every request except health checks and the login settings: RS256 signature checked against the realm's keys, issuer and audience matched, not expired. Identity headers are ignored. A user with no role in the application gets "No access yet".

**Roles and scope.** The six roles are realm roles in Keycloak (`viewer`, `analyst`, `manager`, `steward`, `admin`, `demo_operator`); a user may hold several. An optional `commodity_scope` user attribute (`wheat` or `tungsten`) limits what that user sees; out-of-scope items answer 404. Roles are enforced on every write endpoint and on the reads behind the source health, rules and data, and simulator screens.

**Try it with the Keycloak container** (no existing Keycloak needed):

```
echo "KEYCLOAK_ADMIN_PASSWORD=$(openssl rand -hex 12)" >> .env       # once
docker compose --profile keycloak up -d keycloak
set -a; . ./.env; set +a
DEMO_USER_PASSWORD='choose-a-password' python3 keycloak/setup.py       # sets the seed users' password
AUTH_MODE=keycloak KEYCLOAK_INTERNAL_URL=http://keycloak:8080 docker compose --profile keycloak up -d api
```

Open http://127.0.0.1:8095 and sign in as one of the seed users below. Put `AUTH_MODE=keycloak` and `KEYCLOAK_INTERNAL_URL=http://keycloak:8080` in `.env` to make that permanent. Stop it with `docker compose --profile keycloak stop keycloak`; its data stays in a volume.

| User | Roles | Sees |
| --- | --- | --- |
| `executive.viewer` | viewer | both commodities |
| `risk.analyst.a`, `risk.analyst.b` | analyst | both |
| `procurement.manager` | manager | both |
| `data.steward` | steward | both |
| `platform.admin` | admin | both |
| `demo.operator` | demo_operator | both |
| `wheat.analyst` | analyst | wheat only |
| `tungsten.analyst` | analyst | tungsten only |

**Use an existing Keycloak instead.** Run `keycloak/setup.py` against it with its admin login; it creates the `supplychain` realm (an existing realm is left alone) and sets the seed passwords. For the instance in the local Kubernetes cluster, reach it with `kubectl -n citizen port-forward svc/keycloak 8180:8080`, then point the API at it with `KEYCLOAK_INTERNAL_URL=http://host.docker.internal:8180` in `.env` and `KEYCLOAK_ISSUER` set to the URL browsers use (`http://localhost:8180/realms/supplychain`). Realm settings live in `keycloak/supplychain-realm.json`; no passwords are stored in the repository.

**Action owners** are chosen from `GET /api/people`: everyone who has signed in (demo identities are listed in dev mode only), so a person can be assigned work once they have signed in once.

## Browser checks

```
cd e2e && npm install
APP_URL=http://127.0.0.1:8095 npm run roles                              # dev mode: every role's screens load without errors
DEMO_USER_PASSWORD='...' npm run login                                   # keycloak mode: the real sign-in, roles and scope
```

They use the installed Chrome (`CHROME_PATH` to change it).

## Notes

- All bundled data is synthetic and labelled simulated.
- Client and planning documents are kept out of this repository.
