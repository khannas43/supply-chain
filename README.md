# Supply Chain Risk MVP

Local application that maps a supply chain, detects commodity risk events, assesses business impact and records a response, for wheat and tungsten. Everything runs locally in Docker.

Status: nine screens on the API; ingestion path (collect, worker, rules, alerts) working with the simulator; Docker stack with database, schema, demo data, API and worker. The API serves alerts, network traversal and assessments ; all nine screens use it. Writes need an identity (development headers for now).

## Layout

| Path | Content |
| --- | --- |
| `frontend/` | React, TypeScript and Vite app (nine screens, mock data) |
| `backend/` | FastAPI application, database models, Alembic migrations, sample data (`seed/`) and tests |
| `db/` | PostgreSQL 16 with PostGIS, built on an arm64-capable base image |
| `docker-compose.yml` | The stack: `db`, `api`, `worker`, `web`, the `evidence` volume, and an optional `keycloak` |
| `keycloak/` | The `supplychain` realm (roles, clients, seed users) and `setup.py` to install it in any Keycloak |
| `e2e/` | Browser checks (Playwright) for sign-in, roles and screens |
| `.env.example` | Settings template; copy to `.env` |

## Run the stack

```
cp .env.example .env        # then set POSTGRES_PASSWORD, KEYCLOAK_ADMIN_PASSWORD and DEMO_USER_PASSWORD
docker compose up -d --build
docker compose exec api alembic upgrade head       # first time, and after pulling new migrations
docker compose exec api python -m app.seed         # first time: the demo data
```

Open http://127.0.0.1:8095 and sign in as one of the seed users (table below) with `DEMO_USER_PASSWORD`. Keycloak starts with the stack and a one-shot `keycloak-setup` service installs the realm and gives the seed users their password.

| Service | URL on this machine |
| --- | --- |
| Web app (frontend and `/api`) | http://127.0.0.1:8095 |
| API directly, with docs | http://127.0.0.1:8100/api/docs |
| Keycloak admin console | http://localhost:8180 (user `KEYCLOAK_ADMIN`) |
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
docker compose exec api python -m app.seed --reset   # empty the seeded tables and everything the app created, then reload (see Sample data)
```

The schema is in `backend/app/models.py` and `backend/alembic/versions/`. Rules enforced by the database itself: an assumption cannot be decided by its proposer, one active assumption per alert, one published and one draft version per rule, actions point at an existing assessment snapshot, and audit events cannot be changed or deleted.

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

## Sample data

**The demo set** (`backend/seed/demo.json`) is real geography with fictional companies and synthetic events: every country is real, every company, plant, price, volume and event is invented, and every event is labelled simulated or replay. Nothing in it describes a real policy, shipment or supplier.

| | Wheat | Tungsten |
| --- | --- | --- |
| Supplier network | 37 nodes in 13 countries: origins (Russia, Ukraine, Kazakhstan, Romania, Australia, Canada, France, Germany, United States, Argentina), exporters and terminals, four Tier 1 blenders and millers, five plants, four products | 38 nodes in 15 countries: mines (China, Russia, Vietnam, South Korea, Portugal, Austria, Canada, Australia, Bolivia, Rwanda), concentrators and traders, APT refiners, four carbide-powder makers, four plants, four products |
| Links | 51, with confidence, source and dates; uncertain links, and a loop between two blenders | 51, with the same, and a loop between two traders |
| Alerts | 7, from export restrictions and quotas to port delays; new, confirmed, monitored and dismissed | 6, from export controls to price spikes |
| Assessments | Three assessed alerts with one to three versions each; assumptions approved, superseded and rejected | Two assessed alerts, one waiting for an approver |
| Response options | 12 across the assessed alerts: qualified and unqualified, quotes valid, expiring and expired, inventory | 9 |
| Actions | 7, open, in progress, in review (one overdue) and done; one flagged because the assessment moved on | 5, the same mix |

It also holds the trail behind every alert: the observation, the ingestion and the original payload (open it from the evidence drawer), plus observations that were *not* alerts (merged, late, below threshold, no rule), quarantined records you can correct and replay, dead-letter entries, an import history, 56 pipeline runs and a 69-event audit trail. One source is stale on purpose.

**It never goes stale.** Dates are written relative to a reference moment and moved to "now" when loaded, so sources are as fresh or stale as designed, quotes expire when intended and actions are overdue when intended, whenever you load it. Re-load any time with `docker compose exec api python -m app.seed --reset`.

**Scenarios** for the simulator are data too (`backend/seed/scenarios.json`): *Black Sea wheat disruption* and *Tungsten export controls*.

**Edit it.** The demo set is written in readable Python (`backend/seed/build_demo.py`). Change it, rebuild, and the tests check it against the real engine (payloads pass the validators, exposure matches the traversal, calculations are what was designed):

```
docker compose run --rm --no-deps -u root -v "$PWD/backend:/srv" -w /srv api python seed/build_demo.py
```

**A large set** for testing at scale adds hundreds of generated nodes, alerts, assessments and actions to the demo set (the same arguments always give the same data; `demo-large.json` is not committed):

```
docker compose run --rm --no-deps -u root -v "$PWD/backend:/srv" -w /srv api python seed/generate_large.py --nodes 400 --alerts 200
docker compose cp backend/seed/demo-large.json api:/tmp/demo-large.json
docker compose exec api python -m app.seed --reset --file /tmp/demo-large.json
```

The tests use their own small fixture (`backend/tests/fixtures/`), so changing the demo set does not break them. The Import screen offers a sample file for each dataset that fits the demo network.

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

**Keycloak is part of the stack.** The seed users below get `DEMO_USER_PASSWORD` the first time; after that, change passwords in the Keycloak console and they are never overwritten (`docker compose run --rm keycloak-setup` is safe to repeat). To use the identity switch instead of signing in (local development only):

```
AUTH_MODE=dev docker compose up -d api        # back to normal: docker compose up -d api
```

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

**Using another Keycloak instead** is possible: run `keycloak/setup.py` against it with its admin login (it creates the `supplychain` realm if missing and sets seed passwords), then set `KEYCLOAK_INTERNAL_URL` (how the API reaches it) and `KEYCLOAK_ISSUER` (the address browsers use) in `.env`. Realm settings live in `keycloak/supplychain-realm.json`; no passwords are stored in the repository.

**Action owners** are chosen from `GET /api/people`: everyone who has signed in (demo identities are listed in dev mode only), so a person can be assigned work once they have signed in once.

## Browser checks

```
cd e2e && npm install
set -a; . ../.env; set +a
npm run login                                       # the real sign-in, roles and scope (needs AUTH_MODE=keycloak, the default)
AUTH_MODE=dev docker compose up -d api && npm run roles    # dev mode: every role's screens load without errors
```

They use the installed Chrome (`CHROME_PATH` to change it).

## Notes

- All bundled data is synthetic and labelled simulated.
- Client and planning documents are kept out of this repository.
