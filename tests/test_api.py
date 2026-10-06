import time
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from aozora_feed.api import create_app
from aozora_feed.config import Settings
from aozora_feed.stream import subscription_url


def test_at_protocol_endpoints(settings):
    with TestClient(create_app(settings)) as client:
        document = client.get("/.well-known/did.json").json()
        assert document["id"] == settings.service_did
        assert document["service"][0]["type"] == "BskyFeedGenerator"
        assert client.get("/xrpc/app.bsky.feed.describeFeedGenerator").json() == {
            "did": settings.service_did,
            "feeds": [{"uri": settings.feed_uri}],
        }
        response = client.get(
            "/xrpc/app.bsky.feed.getFeedSkeleton", params={"feed": settings.feed_uri}
        )
        assert response.status_code == 200
        assert response.json() == {"feed": []}
        assert client.get("/").status_code == 200
        assert client.get("/livez").status_code == 200
        assert client.get("/healthz").status_code == 200


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"feed": "wrong"},
        {"limit": 0},
        {"limit": 101},
        {"limit": "x"},
        {"cursor": "tampered"},
    ],
)
def test_xrpc_bad_requests_use_400(settings, params):
    with TestClient(create_app(settings)) as client:
        merged = {"feed": settings.feed_uri} | params
        if not params:
            merged = {}
        response = client.get("/xrpc/app.bsky.feed.getFeedSkeleton", params=merged)
        assert response.status_code == 400
        assert response.json()["error"] in {"InvalidRequest", "UnknownFeed"}


def test_health_exposes_disconnection_and_staleness(settings):
    with TestClient(create_app(settings)) as client:
        # Exercise status without opening an external network connection.
        consumer = client.app.state.consumer
        assert not client.portal.call(consumer.status)["caught_up"]

        def set_cursor(age):
            consumer.connected = True
            with client.app.state.store.db:
                client.app.state.store.set_meta(
                    "stream_cursor", str(int((time.time() - age) * 1e6))
                )

        client.portal.call(set_cursor, 3600)
        assert not client.portal.call(consumer.status)["caught_up"]
        client.portal.call(set_cursor, 0)
        assert client.portal.call(consumer.status)["caught_up"]


def test_subscription_filters_and_replay_cursor():
    from urllib.parse import parse_qs, urlsplit

    query = parse_qs(urlsplit(subscription_url("wss://example.com/subscribe?cursor=1", 42)).query)
    assert query["cursor"] == ["42"]
    assert query["wantedCollections"] == [
        "app.bsky.feed.post",
        "app.bsky.feed.like",
        "app.bsky.feed.repost",
    ]
    assert query["compress"] == ["false"]


@pytest.mark.parametrize(
    "changes",
    [
        {"hostname": "https://example.com"},
        {"publisher_did": "alice.bsky.social"},
        {"feed_rkey": "bad/key"},
        {"backfill_hours": 25},
        {"snapshot_ttl": 10},
        {"max_posts_per_author": 0},
        {"jetstream_urls": ("ws://example.com",)},
        {"allowed_authors": frozenset({"alice.bsky.social"})},
    ],
)
def test_config_rejects_invalid_settings(changes):
    with pytest.raises(ValueError):
        replace(Settings(), **changes)
