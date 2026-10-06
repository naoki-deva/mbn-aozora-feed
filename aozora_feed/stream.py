import asyncio
import json
import logging
import os
import random
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import aiohttp

from .config import Settings
from .ranking import WINDOW_SECONDS
from .store import COLLECTIONS, Store

logger = logging.getLogger(__name__)


def subscription_url(endpoint: str, cursor: int) -> str:
    url = urlsplit(endpoint)
    query = [
        (key, value)
        for key, value in parse_qsl(url.query)
        if key not in {"wantedCollections", "cursor", "compress"}
    ]
    query.extend(("wantedCollections", collection) for collection in COLLECTIONS)
    query.extend([("cursor", str(cursor)), ("compress", "false")])
    return urlunsplit((url.scheme, url.netloc, url.path, urlencode(query), ""))


class JetstreamConsumer:
    def __init__(self, settings: Settings, store: Store):
        self.settings = settings
        self.store = store
        self.connected = False
        self.last_received_at: float | None = None
        self.started_at = time.time()
        self.initial_cursor = store.stream_cursor or int(
            (self.started_at - settings.backfill_hours * 3600) * 1_000_000
        )
        self.last_prune = 0.0

    def status(self) -> dict:
        now = time.time()
        cursor = self.store.stream_cursor
        lag = max(0.0, now - cursor / 1_000_000) if cursor else None
        return {
            "enabled": self.settings.stream_enabled,
            "connected": self.connected,
            "last_received_at": self.last_received_at,
            "lag_seconds": round(lag, 1) if lag is not None else None,
            "caught_up": bool(self.connected and lag is not None and lag < 120),
            "requested_backfill_hours": self.settings.backfill_hours,
        }

    async def run(self) -> None:
        attempt = 0
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=20, sock_read=60)
        # aiohttp's websocket proxy lookup uses WSS_PROXY; also honor HTTPS_PROXY explicitly.
        proxy = os.getenv("WSS_PROXY") or os.getenv("HTTPS_PROXY") or os.getenv("https_proxy")
        async with aiohttp.ClientSession(timeout=timeout, trust_env=True) as session:
            while True:
                endpoint = self.settings.jetstream_urls[attempt % len(self.settings.jetstream_urls)]
                now = time.time()
                cursor = max(
                    int((now - WINDOW_SECONDS) * 1_000_000),
                    (self.store.stream_cursor or self.initial_cursor) - 5_000_000,
                )
                batch: list[dict] = []
                try:
                    async with session.ws_connect(
                        subscription_url(endpoint, cursor),
                        heartbeat=20,
                        max_msg_size=2 * 1024 * 1024,
                        proxy=proxy,
                    ) as websocket:
                        self.connected = True
                        logger.info("Jetstream connected to %s", urlsplit(endpoint).hostname)
                        last_flush = time.monotonic()
                        while True:
                            try:
                                message = await asyncio.wait_for(websocket.receive(), timeout=0.5)
                            except TimeoutError:
                                message = None
                            if message is not None:
                                if message.type == aiohttp.WSMsgType.TEXT:
                                    try:
                                        event = json.loads(message.data)
                                        if isinstance(event, dict):
                                            batch.append(event)
                                            self.last_received_at = time.time()
                                    except json.JSONDecodeError:
                                        logger.warning("Ignoring malformed Jetstream JSON")
                                elif message.type in {
                                    aiohttp.WSMsgType.CLOSE,
                                    aiohttp.WSMsgType.CLOSED,
                                    aiohttp.WSMsgType.ERROR,
                                }:
                                    raise ConnectionError("Jetstream websocket closed")
                            if len(batch) >= 500 or time.monotonic() - last_flush >= 0.5:
                                if batch:
                                    self.store.ingest_batch(batch)
                                    batch.clear()
                                last_flush = time.monotonic()
                            if time.time() - self.last_prune >= 60:
                                self.store.prune()
                                self.last_prune = time.time()
                            if self.last_received_at and time.time() - self.last_received_at > 60:
                                raise ConnectionError("Jetstream stopped delivering events")
                except asyncio.CancelledError:
                    raise
                except (aiohttp.ClientError, ConnectionError, TimeoutError, OSError) as error:
                    logger.warning("Jetstream reconnect required (%s)", type(error).__name__)
                finally:
                    self.connected = False
                    if batch:
                        self.store.ingest_batch(batch)
                # Rotate endpoints and use bounded exponential backoff with jitter.
                if self.last_received_at and time.time() - self.last_received_at < 10:
                    attempt = (attempt + 1) % len(self.settings.jetstream_urls)
                    delay = 1.0
                else:
                    attempt += 1
                    delay = min(60.0, 2.0 ** min(attempt, 6))
                await asyncio.sleep(delay + random.random())
