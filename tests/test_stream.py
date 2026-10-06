import asyncio
import json
import time

import aiohttp
import pytest
from conftest import event, post

from aozora_feed.stream import JetstreamConsumer


def test_collector_flushes_on_connection_close_and_ignores_invalid_json(
    store,
    settings,
    monkeypatch,
):
    now = time.time()
    payload = event("live", post(created=now - 1), timestamp=now)
    messages = iter(
        [
            aiohttp.WSMessage(aiohttp.WSMsgType.TEXT, "invalid JSON", ""),
            aiohttp.WSMessage(aiohttp.WSMsgType.TEXT, json.dumps(payload), ""),
            aiohttp.WSMessage(aiohttp.WSMsgType.CLOSED, None, ""),
        ]
    )
    urls = []

    class FakeSocket:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def receive(self):
            return next(messages)

    class FakeSession:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        def ws_connect(self, url, **_):
            urls.append(url)
            return FakeSocket()

    async def stop_after_disconnect(_):
        raise asyncio.CancelledError()

    monkeypatch.setattr(aiohttp, "ClientSession", FakeSession)
    monkeypatch.setattr(asyncio, "sleep", stop_after_disconnect)
    consumer = JetstreamConsumer(settings, store)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(consumer.run())
    assert store.stats()["posts"] == 1
    assert store.stream_cursor == payload["time_us"]
    assert not consumer.connected
    assert "wantedCollections=app.bsky.feed.like" in urls[0]
