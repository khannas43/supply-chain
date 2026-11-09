from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    # "dev": the caller's identity is read from X-Actor-* headers. For local development only;
    # it is replaced by Keycloak token validation and must never face a network.
    auth_mode: str = "dev"

    # Where preserved original payloads live. A Docker volume today; the EvidenceStore interface
    # lets an S3-compatible store replace it without touching the pipeline.
    evidence_dir: str = "/data/evidence"
    worker_poll_seconds: float = 1.0
    worker_max_attempts: int = 3

    database_url: str = "postgresql+psycopg://supplychain:change-me@db:5432/supplychain"

    # Keycloak runs outside this stack (existing `citizen` instance, reached through a port-forward).
    # The API fetches keys from the internal URL; the issuer is the URL browsers use, so they can differ.
    keycloak_internal_url: str = "http://host.docker.internal:8180"
    keycloak_realm: str = "supplychain"
    keycloak_issuer: str = "http://localhost:8180/realms/supplychain"


@lru_cache
def get_settings() -> Settings:
    return Settings()
