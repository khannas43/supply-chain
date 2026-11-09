"""Preserved original payloads ("evidence").

Objects are immutable: the same key can be written again only with identical bytes. The interface
is small on purpose so an S3-compatible store can replace the file store later.
"""

import hashlib
import os
from pathlib import Path
from typing import Protocol

from .config import get_settings


class EvidenceMissing(Exception):
    pass


class EvidenceConflict(Exception):
    pass


class EvidenceStore(Protocol):
    def put(self, key: str, body: bytes) -> str: ...
    def get(self, key: str) -> bytes: ...


def sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


class FileEvidenceStore:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError(f"Evidence key escapes the store: {key!r}")
        return path

    def put(self, key: str, body: bytes) -> str:
        """Write an object and return its SHA-256. Rewriting identical bytes is fine; different bytes are refused."""
        path = self._path(key)
        digest = sha256(body)
        if path.exists():
            if sha256(path.read_bytes()) != digest:
                raise EvidenceConflict(f"{key} already exists with different content")
            return digest
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_bytes(body)
        os.replace(tmp, path)  # atomic: readers never see a half-written object
        return digest

    def get(self, key: str) -> bytes:
        path = self._path(key)
        if not path.exists():
            raise EvidenceMissing(key)
        return path.read_bytes()


_store: EvidenceStore | None = None


def get_store() -> EvidenceStore:
    global _store
    if _store is None:
        _store = FileEvidenceStore(Path(get_settings().evidence_dir))
    return _store


def set_store(store: EvidenceStore | None) -> None:
    """For tests."""
    global _store
    _store = store
