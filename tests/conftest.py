from datetime import UTC, datetime
from pathlib import Path

import pytest

from aozora_feed.config import Settings
from aozora_feed.store import POST, Store

NOW = 1_790_000_000.0
AUTHOR = "did:plc:author"


def stamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, UTC).isoformat().replace("+00:00", "Z")


def event(
    rkey: str,
    record: dict | None = None,
    *,
    did: str = AUTHOR,
    collection: str = POST,
    operation: str = "create",
    timestamp: float = NOW,
) -> dict:
    return {
        "did": did,
        "time_us": int(timestamp * 1_000_000),
        "kind": "commit",
        "commit": {
            "operation": operation,
            "collection": collection,
            "rkey": rkey,
            "record": record or {},
        },
    }


def post(text: str = "今日もいい天気ですね", created: float = NOW - 3600, **extra) -> dict:
    return {"text": text, "createdAt": stamp(created), **extra}


def uri(rkey: str, did: str = AUTHOR, collection: str = POST) -> str:
    return f"at://{did}/{collection}/{rkey}"


@pytest.fixture
def settings():
    return Settings(database_path=Path(":memory:"), stream_enabled=False)


@pytest.fixture
def store(settings):
    database = Store(settings)
    yield database
    database.close()
