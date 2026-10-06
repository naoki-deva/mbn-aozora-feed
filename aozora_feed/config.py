import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

DID_RE = re.compile(r"^did:(plc:[a-z2-7]+|web:[A-Za-z0-9._:%-]+)$")


def csv_set(value: str) -> frozenset[str]:
    return frozenset(item.strip() for item in value.split(",") if item.strip())


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name, str(default)).lower()
    if value not in {"true", "false", "1", "0"}:
        raise ValueError(f"{name} must be true or false")
    return value in {"true", "1"}


@dataclass(frozen=True)
class Settings:
    hostname: str = "localhost"
    publisher_did: str = "did:web:localhost"
    feed_rkey: str = "aozora-jp"
    database_path: Path = Path("data/feed.sqlite3")
    stream_enabled: bool = True
    jetstream_urls: tuple[str, ...] = (
        "wss://jetstream2.us-west.bsky.network/subscribe",
        "wss://jetstream1.us-east.bsky.network/subscribe",
    )
    backfill_hours: int = 24
    snapshot_ttl: int = 900
    max_posts_per_author: int = 3
    max_feed_posts: int = 1000
    discovery_percent: int = 30
    discovery_max_age_hours: int = 3
    discovery_max_interactions: int = 5
    discovery_max_author_interactions: int = 20
    exclude_replies: bool = True
    include_japan_topics: bool = True
    allowed_authors: frozenset[str] = field(default_factory=frozenset)
    blocked_authors: frozenset[str] = field(default_factory=frozenset)
    cursor_secret: str = ""

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", self.hostname):
            raise ValueError("FEED_HOSTNAME must be a hostname without scheme, port or path")
        if not DID_RE.fullmatch(self.publisher_did):
            raise ValueError("FEED_PUBLISHER_DID must be a DID")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", self.feed_rkey):
            raise ValueError("FEED_RKEY must contain 1-64 letters, digits, underscores or hyphens")
        if not 0 <= self.backfill_hours <= 24:
            raise ValueError("BACKFILL_HOURS must be between 0 and 24")
        if not 60 <= self.snapshot_ttl <= 3600:
            raise ValueError("SNAPSHOT_TTL_SECONDS must be between 60 and 3600")
        if not 1 <= self.max_posts_per_author <= 100:
            raise ValueError("MAX_POSTS_PER_AUTHOR must be between 1 and 100")
        if not 1 <= self.max_feed_posts <= 5000:
            raise ValueError("MAX_FEED_POSTS must be between 1 and 5000")
        if not 0 <= self.discovery_percent <= 100:
            raise ValueError("DISCOVERY_PERCENT must be between 0 and 100")
        if not 1 <= self.discovery_max_age_hours <= 24:
            raise ValueError("DISCOVERY_MAX_AGE_HOURS must be between 1 and 24")
        if self.discovery_max_interactions < 0 or self.discovery_max_author_interactions < 0:
            raise ValueError("Discovery interaction thresholds must be non-negative")
        if not self.jetstream_urls or any(
            urlsplit(url).scheme != "wss"
            or not urlsplit(url).hostname
            or urlsplit(url).username is not None
            for url in self.jetstream_urls
        ):
            raise ValueError("JETSTREAM_URLS must contain secure websocket URLs")
        if any(not DID_RE.fullmatch(did) for did in self.allowed_authors | self.blocked_authors):
            raise ValueError("Author lists must contain DIDs, not handles")

    @property
    def service_did(self) -> str:
        return f"did:web:{self.hostname}"

    @property
    def feed_uri(self) -> str:
        return f"at://{self.publisher_did}/app.bsky.feed.generator/{self.feed_rkey}"

    @property
    def public_configured(self) -> bool:
        return self.hostname != "localhost" and self.publisher_did != "did:web:localhost"

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        return cls(
            hostname=os.getenv("FEED_HOSTNAME", "localhost"),
            publisher_did=os.getenv("FEED_PUBLISHER_DID", "did:web:localhost"),
            feed_rkey=os.getenv("FEED_RKEY", "aozora-jp"),
            database_path=Path(os.getenv("DATABASE_PATH", "data/feed.sqlite3")),
            stream_enabled=env_bool("STREAM_ENABLED", True),
            jetstream_urls=tuple(
                url.strip()
                for url in os.getenv("JETSTREAM_URLS", ",".join(cls().jetstream_urls)).split(",")
            ),
            backfill_hours=int(os.getenv("BACKFILL_HOURS", "24")),
            snapshot_ttl=int(os.getenv("SNAPSHOT_TTL_SECONDS", "900")),
            max_posts_per_author=int(os.getenv("MAX_POSTS_PER_AUTHOR", "3")),
            max_feed_posts=int(os.getenv("MAX_FEED_POSTS", "1000")),
            discovery_percent=int(os.getenv("DISCOVERY_PERCENT", "30")),
            discovery_max_age_hours=int(os.getenv("DISCOVERY_MAX_AGE_HOURS", "3")),
            discovery_max_interactions=int(os.getenv("DISCOVERY_MAX_INTERACTIONS", "5")),
            discovery_max_author_interactions=int(
                os.getenv("DISCOVERY_MAX_AUTHOR_INTERACTIONS", "20")
            ),
            exclude_replies=env_bool("EXCLUDE_REPLIES", True),
            include_japan_topics=env_bool("INCLUDE_JAPAN_TOPICS", True),
            allowed_authors=csv_set(os.getenv("ALLOWED_AUTHOR_DIDS", "")),
            blocked_authors=csv_set(os.getenv("BLOCKED_AUTHOR_DIDS", "")),
            cursor_secret=os.getenv("CURSOR_SECRET", ""),
        )
