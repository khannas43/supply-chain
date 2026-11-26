"""Credibl client: fetches Credibl's tungsten data and hands the raw response to collection.

Two implementations behind one small interface, chosen by CREDIBL_MODE:
  mock  replays seed/credibl_mock.json. Collected as "simulated", so it can never look live.
  http  calls the real API (OAuth 2.0 client credentials, or an API key), follows pages, backs off on 429.

The response shape, endpoint paths and paging scheme are ASSUMPTIONS taken from Credibl's written
answers; the real specification is still to come (our queries A3, C2, D1). Everything that depends
on them is in this file and in processing._credibl, so a correction touches only those.

    python -m app.credibl poll        # one collection, then let the worker process it
"""

import json
import logging
import time
from datetime import timedelta
from pathlib import Path
from typing import Protocol

import httpx
from sqlalchemy.orm import Session

from . import clock
from .collect import Collected, add_run, collect
from .config import Settings, get_settings
from .models import Source, SourceCommodity

log = logging.getLogger("credibl")

SOURCE_ID = "src-credibl"
SOURCE_NAME = "Credibl (tungsten data and scores)"
POLICY_HOURS = 72  # a poll that stops delivering usable data reads as stale after three days
MOCK_FILE = Path(__file__).resolve().parent.parent / "seed" / "credibl_mock.json"


class CreditblError(Exception):
    pass


class CreditblClient(Protocol):
    mode: str  # the data mode its payloads are collected under: live or simulated

    def fetch(self, commodity: str) -> bytes:
        """The raw response, as a {"schemaVersion": 1, "records": [...]} document."""


class MockCredibl:
    mode = "simulated"

    def __init__(self, path: Path = MOCK_FILE):
        self.path = path

    def fetch(self, commodity: str) -> bytes:
        today = clock.now().replace(hour=0, minute=0, second=0, microsecond=0)
        records = []
        for r in json.loads(self.path.read_text())["records"]:
            as_of = today - timedelta(days=r["asOfDaysAgo"])
            # one stable record per value per as-of date: polling twice in a day collects the same bytes
            records.append({
                "recordId": f"{r['code']}:{r['country']}:{as_of:%Y%m%d}", "commodity": commodity, "indicator": r["code"],
                "country": r["country"], "value": r["value"], "headline": r["headline"], "confidencePct": r["confidencePct"],
                "provenance": {
                    "asOf": as_of.isoformat(), "lastRefreshed": (today - timedelta(hours=r["refreshedHoursAgo"])).isoformat(),
                    "source": r["source"], "licenceClass": r["licenceClass"], "attribution": r["attribution"],
                    "staleness": r["staleness"], "completeness": r["completeness"],
                },
            })
        return json.dumps({"schemaVersion": 1, "records": records}, sort_keys=True).encode()


class HttpCredibl:
    mode = "live"
    MAX_PAGES = 50
    MAX_RETRIES = 3

    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        if not settings.credibl_base_url:
            raise CreditblError("CREDIBL_BASE_URL is not set")
        self.s = settings
        self.http = client or httpx.Client(timeout=settings.credibl_timeout_seconds)
        self._token: tuple[str, float] | None = None

    def _headers(self) -> dict[str, str]:
        if self.s.credibl_api_key:
            return {"X-API-Key": self.s.credibl_api_key}
        if self._token is None or self._token[1] < time.monotonic() + 30:
            r = self.http.post(self.s.credibl_token_url, data={
                "grant_type": "client_credentials", "client_id": self.s.credibl_client_id, "client_secret": self.s.credibl_client_secret,
            })
            if r.status_code != 200:
                raise CreditblError(f"Token request failed: HTTP {r.status_code}")
            body = r.json()
            self._token = (body["access_token"], time.monotonic() + float(body.get("expires_in", 300)))
        return {"Authorization": f"Bearer {self._token[0]}"}

    def _get(self, url: str, params: dict | None = None) -> dict:
        for attempt in range(self.MAX_RETRIES + 1):
            r = self.http.get(url, params=params, headers=self._headers())
            if r.status_code == 429 and attempt < self.MAX_RETRIES:
                time.sleep(min(float(r.headers.get("Retry-After", 2**attempt)), 30))
                continue
            if r.status_code != 200:
                raise CreditblError(f"HTTP {r.status_code} from {url}")
            return r.json()
        raise CreditblError("Rate limited")

    def fetch(self, commodity: str) -> bytes:
        url, params, records = f"{self.s.credibl_base_url.rstrip('/')}/v1/commodities/{commodity}/indicators", {"limit": 200}, []
        for _ in range(self.MAX_PAGES):
            page = self._get(url, params)
            records += page.get("records", [])
            cursor = page.get("nextCursor")  # assumed cursor paging (query C2)
            if not cursor:
                return json.dumps({"schemaVersion": 1, "records": records}, sort_keys=True).encode()
            params = {"limit": 200, "cursor": cursor}
        raise CreditblError(f"More than {self.MAX_PAGES} pages; stopping")


def get_client(settings: Settings | None = None) -> CreditblClient | None:
    s = settings or get_settings()
    if s.credibl_mode == "mock":
        return MockCredibl()
    if s.credibl_mode == "http":
        return HttpCredibl(s)
    return None


def ensure_source(session: Session, client: CreditblClient) -> Source:
    src = session.get(Source, SOURCE_ID)
    if src is None:
        src = Source(id=SOURCE_ID, name=SOURCE_NAME, mode=client.mode, enabled=True, policy_hours=POLICY_HOURS)
        session.add(src)
        session.add(SourceCommodity(source_id=SOURCE_ID, commodity="tungsten"))
        session.flush()
    elif src.mode != client.mode:
        src.mode = client.mode  # switching between mock and http relabels the source
    return src


def poll(session: Session, client: CreditblClient, commodity: str = "tungsten") -> Collected | None:
    """Fetch once and collect the raw response. The worker does the rest. Returns None if the fetch failed."""
    src = ensure_source(session, client)
    if not src.enabled:
        return None
    try:
        body = client.fetch(commodity)
    except (CreditblError, httpx.HTTPError, ValueError) as exc:
        src.last_attempt, src.last_error = clock.now(), f"{type(exc).__name__}: {exc}"[:300]
        add_run(session, SOURCE_ID, "failed", 0, 0, 0, src.last_error)
        return None
    return collect(session, SOURCE_ID, body, mode=client.mode)


def main() -> None:
    import sys

    from .db import get_engine

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    client = get_client()
    if client is None or sys.argv[1:] != ["poll"]:
        raise SystemExit("usage: CREDIBL_MODE=mock|http python -m app.credibl poll")
    with Session(get_engine()) as session:
        got = poll(session, client)
        session.commit()
    log.info("collected %s", f"{got.ingestion_id}{' (duplicate)' if got.duplicate else ''}" if got else "nothing (see the source's last error)")


if __name__ == "__main__":
    main()
