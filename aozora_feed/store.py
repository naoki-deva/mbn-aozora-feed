import base64
import hashlib
import hmac
import secrets
import sqlite3
import time
from collections import Counter
from pathlib import Path
from typing import Any

from .config import Settings
from .ranking import (
    WINDOW_SECONDS,
    classify,
    has_excluded_labels,
    parse_timestamp,
    score,
)

POST = "app.bsky.feed.post"
LIKE = "app.bsky.feed.like"
REPOST = "app.bsky.feed.repost"
COLLECTIONS = (POST, LIKE, REPOST)


class InvalidCursor(ValueError):
    pass


class Store:
    """Single-process SQLite store. Raw post text and requester identity are not stored."""

    def __init__(self, settings: Settings):
        self.settings = settings
        if str(settings.database_path) != ":memory:":
            Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(settings.database_path))
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS posts (
                uri TEXT PRIMARY KEY, author TEXT NOT NULL, created_at REAL NOT NULL,
                japanese INTEGER NOT NULL, japan_topic INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS posts_age ON posts(created_at);
            CREATE TABLE IF NOT EXISTS interactions (
                uri TEXT PRIMARY KEY, subject TEXT NOT NULL, actor TEXT NOT NULL,
                kind TEXT NOT NULL, created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS interactions_subject
                ON interactions(subject, kind, actor, created_at);
            CREATE INDEX IF NOT EXISTS interactions_age ON interactions(created_at);
            CREATE INDEX IF NOT EXISTS interactions_actor ON interactions(actor);
            CREATE TABLE IF NOT EXISTS versions (
                uri TEXT PRIMARY KEY, time_us INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS versions_age ON versions(time_us);
            CREATE TABLE IF NOT EXISTS account_state (
                did TEXT PRIMARY KEY, active INTEGER NOT NULL, time_us INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS snapshots (
                id TEXT PRIMARY KEY, created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS snapshot_posts (
                snapshot_id TEXT NOT NULL, position INTEGER NOT NULL, uri TEXT NOT NULL,
                PRIMARY KEY(snapshot_id, position)
            );
            CREATE INDEX IF NOT EXISTS snapshot_uri ON snapshot_posts(uri);
        """)
        secret = settings.cursor_secret or self.get_meta("cursor_secret") or secrets.token_hex(32)
        self.secret = secret.encode()
        with self.db:
            self.set_meta("cursor_secret", secret)

    def close(self) -> None:
        self.db.close()

    def get_meta(self, key: str) -> str | None:
        row = self.db.execute("SELECT value FROM metadata WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    def set_meta(self, key: str, value: str) -> None:
        self.db.execute(
            "INSERT INTO metadata VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )

    @property
    def stream_cursor(self) -> int | None:
        value = self.get_meta("stream_cursor")
        return int(value) if value else None

    def ingest_batch(self, events: list[dict[str, Any]], now: float | None = None) -> None:
        """Commit state and replay position together; reconnect replay is idempotent."""
        now = time.time() if now is None else now
        cursor = self.stream_cursor or 0
        with self.db:
            for event in events:
                event_us = event.get("time_us")
                if not isinstance(event_us, int) or isinstance(event_us, bool) or event_us <= 0:
                    continue
                if event_us > (now + 300) * 1_000_000:
                    continue
                self._apply_event(event, event_us, now)
                cursor = max(cursor, event_us)
            if cursor:
                self.set_meta("stream_cursor", str(cursor))

    def _remove_post(self, uri: str) -> None:
        self.db.execute("DELETE FROM posts WHERE uri=?", (uri,))
        self.db.execute("DELETE FROM interactions WHERE subject=?", (uri,))
        self.db.execute("DELETE FROM snapshot_posts WHERE uri=?", (uri,))

    def _account_event(self, event: dict[str, Any], event_us: int) -> None:
        did = event["did"]
        account = event.get("account")
        if not isinstance(account, dict) or not isinstance(account.get("active"), bool):
            return
        previous = self.db.execute(
            "SELECT time_us FROM account_state WHERE did=?", (did,)
        ).fetchone()
        if previous and previous[0] >= event_us:
            return
        active = account["active"]
        self.db.execute(
            "INSERT INTO account_state VALUES (?, ?, ?) ON CONFLICT(did) DO UPDATE SET "
            "active=excluded.active, time_us=excluded.time_us",
            (did, active, event_us),
        )
        if not active:
            for row in self.db.execute("SELECT uri FROM posts WHERE author=?", (did,)).fetchall():
                self._remove_post(row[0])
            self.db.execute("DELETE FROM interactions WHERE actor=?", (did,))

    def _apply_event(self, event: dict[str, Any], event_us: int, now: float) -> None:
        did = event.get("did")
        if not isinstance(did, str) or not did.startswith("did:"):
            return
        if event.get("kind") == "account":
            self._account_event(event, event_us)
            return
        commit = event.get("commit")
        if event.get("kind") != "commit" or not isinstance(commit, dict):
            return
        collection, rkey = commit.get("collection"), commit.get("rkey")
        if collection not in COLLECTIONS or not isinstance(rkey, str) or not rkey:
            return
        uri = f"at://{did}/{collection}/{rkey}"
        previous = self.db.execute("SELECT time_us FROM versions WHERE uri=?", (uri,)).fetchone()
        if previous and event_us <= previous[0]:
            return
        operation = commit.get("operation")
        if not isinstance(operation, str) or operation not in {"create", "update", "delete"}:
            return
        if operation == "delete":
            self._remove_post(uri)
            self.db.execute("DELETE FROM interactions WHERE uri=?", (uri,))
            self._version(uri, event_us)
            return
        state = self.db.execute("SELECT active FROM account_state WHERE did=?", (did,)).fetchone()
        if did in self.settings.blocked_authors or (state and not state[0]):
            return
        record = commit.get("record")
        if not isinstance(record, dict):
            return
        created = parse_timestamp(record.get("createdAt"))
        if created is None or not now - WINDOW_SECONDS <= created <= now + 300:
            # An update that ceases to qualify must also remove its previous version.
            if previous:
                self._remove_post(uri)
                self.db.execute("DELETE FROM interactions WHERE uri=?", (uri,))
                self._version(uri, event_us)
            return
        old_interaction = self.db.execute(
            "SELECT * FROM interactions WHERE uri=?", (uri,)
        ).fetchone()
        self.db.execute("DELETE FROM interactions WHERE uri=?", (uri,))
        tracked = False
        if collection == POST:
            signals = classify(record, self.settings.include_japan_topics)
            reply = record.get("reply")
            allowed = not self.settings.allowed_authors or did in self.settings.allowed_authors
            eligible = (
                signals.eligible
                and allowed
                and not has_excluded_labels(record)
                and not (self.settings.exclude_replies and isinstance(reply, dict))
            )
            if eligible:
                self.db.execute(
                    "INSERT INTO posts VALUES (?, ?, ?, ?, ?) ON CONFLICT(uri) DO UPDATE SET "
                    "created_at=excluded.created_at, japanese=excluded.japanese, "
                    "japan_topic=excluded.japan_topic",
                    (uri, did, created, signals.japanese, signals.japan_topic),
                )
                tracked = True
            else:
                self._remove_post(uri)
            if isinstance(reply, dict) and not has_excluded_labels(record):
                parent = reply.get("parent")
                subject = parent.get("uri") if isinstance(parent, dict) else None
                tracked |= self._interaction(
                    uri, subject, did, "reply", created, event_us, old_interaction
                )
        else:
            subject = record.get("subject")
            target = subject.get("uri") if isinstance(subject, dict) else None
            tracked = self._interaction(
                uri,
                target,
                did,
                "like" if collection == LIKE else "repost",
                created,
                event_us,
                old_interaction,
            )
        if tracked or previous:
            self._version(uri, event_us)

    def _version(self, uri: str, event_us: int) -> None:
        self.db.execute(
            "INSERT INTO versions VALUES (?, ?) ON CONFLICT(uri) DO UPDATE SET "
            "time_us=excluded.time_us",
            (uri, event_us),
        )

    def _interaction(
        self,
        uri: str,
        subject: Any,
        actor: str,
        kind: str,
        created: float,
        event_us: int,
        previous: sqlite3.Row | None,
    ) -> bool:
        if not isinstance(subject, str):
            return False
        target = self.db.execute("SELECT author FROM posts WHERE uri=?", (subject,)).fetchone()
        if not target or target[0] == actor:
            return False
        created = min(created, event_us / 1_000_000)
        if previous and previous["subject"] == subject and previous["kind"] == kind:
            created = min(created, previous["created_at"])
        self.db.execute(
            "INSERT INTO interactions VALUES (?, ?, ?, ?, ?)",
            (uri, subject, actor, kind, created),
        )
        return True

    def prune(self, now: float | None = None) -> None:
        now = time.time() if now is None else now
        with self.db:
            self.db.execute("DELETE FROM posts WHERE created_at < ?", (now - WINDOW_SECONDS,))
            self.db.execute(
                "DELETE FROM interactions WHERE created_at < ? "
                "OR subject NOT IN (SELECT uri FROM posts)",
                (now - WINDOW_SECONDS,),
            )
            self.db.execute(
                "DELETE FROM versions WHERE time_us < ?",
                (int((now - WINDOW_SECONDS - 300) * 1_000_000),),
            )
            self.db.execute(
                "DELETE FROM account_state WHERE time_us < ?",
                (int((now - WINDOW_SECONDS - 300) * 1_000_000),),
            )
            self.db.execute(
                "DELETE FROM snapshots WHERE created_at < ?", (now - self.settings.snapshot_ttl,)
            )
            self.db.execute(
                "DELETE FROM snapshot_posts WHERE snapshot_id NOT IN (SELECT id FROM snapshots) "
                "OR uri NOT IN (SELECT uri FROM posts)"
            )

    def ranked_posts(self, now: float) -> list[str]:
        rows = self.db.execute(
            """
            SELECT p.*, COALESCE(c.likes, 0) likes, COALESCE(c.reposts, 0) reposts,
                COALESCE(c.replies, 0) replies, COALESCE(c.recent_likes, 0) recent_likes,
                COALESCE(c.recent_reposts, 0) recent_reposts,
                COALESCE(c.recent_replies, 0) recent_replies
            FROM posts p LEFT JOIN (
                SELECT subject,
                    COUNT(DISTINCT CASE WHEN kind='like' THEN actor END) likes,
                    COUNT(DISTINCT CASE WHEN kind='repost' THEN actor END) reposts,
                    COUNT(DISTINCT CASE WHEN kind='reply' THEN actor END) replies,
                    COUNT(DISTINCT CASE WHEN kind='like' AND created_at >= ?
                        THEN actor END) recent_likes,
                    COUNT(DISTINCT CASE WHEN kind='repost' AND created_at >= ?
                        THEN actor END) recent_reposts,
                    COUNT(DISTINCT CASE WHEN kind='reply' AND created_at >= ?
                        THEN actor END) recent_replies
                FROM interactions WHERE created_at BETWEEN ? AND ? GROUP BY subject
            ) c ON c.subject=p.uri WHERE p.created_at BETWEEN ? AND ?
        """,
            (
                now - 3600,
                now - 3600,
                now - 3600,
                now - WINDOW_SECONDS,
                now,
                now - WINDOW_SECONDS,
                now,
            ),
        ).fetchall()
        ranked = sorted(
            rows,
            key=lambda row: (
                -score(
                    age_hours=(now - row["created_at"]) / 3600,
                    **{
                        key: row[key]
                        for key in (
                            "likes",
                            "reposts",
                            "replies",
                            "recent_likes",
                            "recent_reposts",
                            "recent_replies",
                            "japanese",
                            "japan_topic",
                        )
                    },
                ),
                -row["created_at"],
                row["uri"],
            ),
        )
        return self._mix_posts(ranked, now)

    def _mix_posts(self, ranked: list[sqlite3.Row], now: float) -> list[str]:
        author_interactions: Counter[str] = Counter()
        for row in ranked:
            author_interactions[row["author"]] += row["likes"] + row["reposts"] + row["replies"]
        eligible = [row for row in ranked if self._author_allowed(row["uri"])]
        discovery = (
            [
                row
                for row in eligible
                if row["created_at"] >= now - self.settings.discovery_max_age_hours * 3600
                and row["likes"] + row["reposts"] + row["replies"]
                <= self.settings.discovery_max_interactions
                and author_interactions[row["author"]]
                <= self.settings.discovery_max_author_interactions
            ]
            if self.settings.discovery_percent
            else []
        )
        discovery.sort(key=lambda row: (-row["created_at"], row["uri"]))
        # Give each author one discovery opportunity before selecting their second post.
        ordinals: Counter[str] = Counter()
        rounds = []
        for row in discovery:
            rounds.append((ordinals[row["author"]], row))
            ordinals[row["author"]] += 1
        rounds.sort(key=lambda item: (item[0], -item[1]["created_at"], item[1]["uri"]))
        discovery_queue = iter(row for _, row in rounds)
        trending_queue = iter(eligible)
        counts: Counter[str] = Counter()
        selected: set[str] = set()
        result = []

        def take(queue):
            for row in queue:
                if (
                    row["uri"] in selected
                    or counts[row["author"]] >= self.settings.max_posts_per_author
                ):
                    continue
                return row
            return None

        while len(result) < self.settings.max_feed_posts:
            position = len(result)
            percent = self.settings.discovery_percent
            discovery_slot = (position + 1) * percent // 100 > position * percent // 100
            primary, fallback = (
                (discovery_queue, trending_queue)
                if discovery_slot
                else (trending_queue, discovery_queue)
            )
            row = take(primary)
            if row is None:
                row = take(fallback)
            if row is None:
                break
            selected.add(row["uri"])
            counts[row["author"]] += 1
            result.append(row["uri"])
        return result

    def _new_snapshot(self, now: float) -> str:
        # Reuse rankings for a minute; keep cursors stable even as rankings change.
        latest = self.db.execute(
            "SELECT id, created_at FROM snapshots ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
        if latest and 0 <= now - latest["created_at"] < 60:
            return latest["id"]
        self.prune(now)
        snapshot = secrets.token_hex(16)
        ranked = self.ranked_posts(now)
        with self.db:
            self.db.execute("INSERT INTO snapshots VALUES (?, ?)", (snapshot, now))
            self.db.executemany(
                "INSERT INTO snapshot_posts VALUES (?, ?, ?)",
                ((snapshot, position, uri) for position, uri in enumerate(ranked)),
            )
        return snapshot

    def _encode_cursor(self, snapshot: str, position: int) -> str:
        body = f"{snapshot}:{position}".encode()
        signature = hmac.new(self.secret, body, hashlib.sha256).digest()[:16]
        return base64.urlsafe_b64encode(body + b"." + signature).decode().rstrip("=")

    def _decode_cursor(self, cursor: str) -> tuple[str, int]:
        try:
            if len(cursor) > 200:
                raise ValueError()
            raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
            # Fixed-size signature may itself contain '.', so do not split on it.
            body, separator, signature = raw[:-17], raw[-17:-16], raw[-16:]
            expected = hmac.new(self.secret, body, hashlib.sha256).digest()[:16]
            if separator != b"." or not hmac.compare_digest(signature, expected):
                raise ValueError()
            snapshot, position_str = body.decode().split(":")
            position = int(position_str)
            if len(snapshot) != 32 or not 0 <= position <= self.settings.max_feed_posts:
                raise ValueError()
            return snapshot, position
        except (ValueError, UnicodeError):
            raise InvalidCursor("Invalid cursor; restart without cursor") from None

    def feed_page(
        self,
        limit: int,
        cursor: str | None = None,
        now: float | None = None,
    ) -> dict[str, Any]:
        now = time.time() if now is None else now
        snapshot, position = self._decode_cursor(cursor) if cursor else (self._new_snapshot(now), 0)
        found = self.db.execute(
            "SELECT created_at FROM snapshots WHERE id=?", (snapshot,)
        ).fetchone()
        if not found or found[0] < now - self.settings.snapshot_ttl:
            raise InvalidCursor("Expired cursor; restart without cursor")
        rows = self.db.execute(
            """
            SELECT s.position, s.uri FROM snapshot_posts s JOIN posts p ON p.uri=s.uri
            WHERE s.snapshot_id=? AND s.position>=? AND p.created_at BETWEEN ? AND ?
            ORDER BY s.position
        """,
            (snapshot, position, now - WINDOW_SECONDS, now),
        ).fetchall()
        rows = [row for row in rows if self._author_allowed(row["uri"])][: limit + 1]
        page = rows[:limit]
        result: dict[str, Any] = {"feed": [{"post": row["uri"]} for row in page]}
        if len(rows) > limit:
            result["cursor"] = self._encode_cursor(snapshot, page[-1]["position"] + 1)
        return result

    def _author_allowed(self, uri: str) -> bool:
        author = uri.split("/")[2]
        return author not in self.settings.blocked_authors and (
            not self.settings.allowed_authors or author in self.settings.allowed_authors
        )

    def stats(self) -> dict[str, Any]:
        return {
            "posts": self.db.execute("SELECT COUNT(*) FROM posts").fetchone()[0],
            "interactions": self.db.execute("SELECT COUNT(*) FROM interactions").fetchone()[0],
            "cursor_time_us": self.stream_cursor,
        }
