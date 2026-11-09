"""Message envelopes. Versioned and small: the payload itself stays in evidence storage.

These are the contract between collection (the API now, NiFi later) and the worker. The transport
underneath (database outbox now, Kafka later) can change without touching either side.
"""

from datetime import datetime

from pydantic import BaseModel

TOPIC_RAW = "source.observations.v1"
TOPIC_REPLAY = "replay.requests.v1"


class RawObjectEnvelope(BaseModel):
    schema_version: int = 1
    event_id: str
    source_id: str
    ingestion_id: str
    mode: str  # live, replay, simulated
    scenario_run: str | None = None
    object_key: str
    sha256: str
    content_type: str = "application/json"
    collected_at: datetime


class ReplayEnvelope(BaseModel):
    schema_version: int = 1
    event_id: str
    quarantine_id: str
    requested_by: str
    requested_at: datetime
