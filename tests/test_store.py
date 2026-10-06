from dataclasses import replace

import pytest
from conftest import AUTHOR, NOW, event, post, stamp, uri

from aozora_feed.store import LIKE, POST, REPOST, InvalidCursor, Store


def react(
    rkey, target, *, actor="did:plc:reader", collection=LIKE, timestamp=NOW, created=NOW - 10
):
    return event(
        rkey,
        {"subject": {"uri": target}, "createdAt": stamp(created)},
        did=actor,
        collection=collection,
        timestamp=timestamp,
    )


def test_selection_and_rolling_24_hours(store):
    store.ingest_batch(
        [
            event("ja", post()),
            event("japan", post("I love Kyoto")),
            event("en", post("hello world")),
            event("old", post(created=NOW - 86401)),
            event("future", post(created=NOW + 60)),
            event("bad-date", {"text": "こんにちは", "createdAt": "yesterday"}),
            event("boundary", post(created=NOW - 86400)),
            event("adult", post(labels={"values": [{"val": "porn"}]})),
        ],
        NOW,
    )
    assert set(store.ranked_posts(NOW)) == {uri("ja"), uri("japan"), uri("boundary")}
    assert uri("boundary") not in store.ranked_posts(NOW + 1)


def test_interaction_counts_unique_actors_and_excludes_self(store):
    store.ingest_batch([event("a", post()), event("b", post())], NOW)
    store.ingest_batch(
        [
            react("like1", uri("b")),
            react("like2", uri("b")),
            react("self", uri("b"), actor=AUTHOR),
            react("repost", uri("b"), collection=REPOST),
            react("foreign-target", uri("missing")),
        ],
        NOW,
    )
    assert store.ranked_posts(NOW)[0] == uri("b")
    assert store.stats()["interactions"] == 3
    # Removing one duplicate-like record retains the remaining actor's one vote.
    store.ingest_batch(
        [
            event(
                "like1",
                did="did:plc:reader",
                collection=LIKE,
                operation="delete",
                timestamp=NOW + 1,
            )
        ],
        NOW + 1,
    )
    assert store.ranked_posts(NOW + 1)[0] == uri("b")


def test_reconnect_replay_cannot_revive_deleted_post(store):
    create = event("a", post(), timestamp=NOW - 3)
    store.ingest_batch([create], NOW)
    store.ingest_batch([react("l", uri("a"))], NOW)
    store.ingest_batch([event("a", operation="delete", timestamp=NOW + 1), create], NOW + 1)
    assert store.stats()["posts"] == 0
    assert store.stats()["interactions"] == 0
    assert store.stream_cursor == int((NOW + 1) * 1_000_000)


def test_delete_before_replayed_create(store):
    store.ingest_batch(
        [
            event("a", operation="delete", timestamp=NOW),
            event("a", post(), timestamp=NOW - 1),
        ],
        NOW,
    )
    assert store.stats()["posts"] == 0


def test_reconnect_deduplicates_and_update_changes_target(store):
    store.ingest_batch([event("a", post()), event("b", post())], NOW)
    like = react("l", uri("a"))
    store.ingest_batch([like, like], NOW)
    assert store.stats()["interactions"] == 1
    update = react("l", uri("b"), timestamp=NOW + 1)
    update["commit"]["operation"] = "update"
    store.ingest_batch([update, like], NOW + 1)
    assert store.ranked_posts(NOW + 1)[0] == uri("b")
    assert store.stats()["interactions"] == 1


def test_update_can_remove_ineligible_post(store):
    store.ingest_batch([event("a", post())], NOW)
    store.ingest_batch(
        [event("a", post("hello world"), operation="update", timestamp=NOW + 1)], NOW + 1
    )
    assert store.ranked_posts(NOW + 1) == []


def test_reply_counts_even_when_not_a_feed_candidate(store):
    store.ingest_batch([event("a", post()), event("b", post())], NOW)
    reply = post("hello", reply={"parent": {"uri": uri("b")}, "root": {"uri": uri("b")}})
    store.ingest_batch([event("reply", reply, did="did:plc:reader")], NOW)
    assert store.ranked_posts(NOW)[0] == uri("b")
    assert uri("reply", "did:plc:reader") not in store.ranked_posts(NOW)
    store.ingest_batch(
        [event("reply", did="did:plc:reader", operation="delete", timestamp=NOW + 1)], NOW + 1
    )
    assert store.stats()["interactions"] == 0


def test_author_diversity(store):
    store.ingest_batch(
        [
            *[event(str(index), post(created=NOW - index)) for index in range(6)],
            event("other", post(created=NOW - 1000), did="did:plc:other"),
        ],
        NOW,
    )
    ranked = store.ranked_posts(NOW)
    assert len(ranked) == 4
    assert uri("other", "did:plc:other") in ranked


def test_allowlist_controls_authors_but_does_not_filter_readers(settings):
    store = Store(replace(settings, allowed_authors=frozenset({AUTHOR})))
    try:
        store.ingest_batch(
            [event("a", post()), event("other", post(), did="did:plc:other"), react("l", uri("a"))],
            NOW,
        )
        assert store.ranked_posts(NOW) == [uri("a")]
        assert store.stats()["interactions"] == 1
    finally:
        store.close()


def test_blocked_actor_cannot_inflate_counts(settings):
    store = Store(replace(settings, blocked_authors=frozenset({"did:plc:reader"})))
    try:
        store.ingest_batch([event("a", post()), react("l", uri("a"))], NOW)
        assert store.stats()["interactions"] == 0
    finally:
        store.close()


def test_pagination_survives_reordering_and_post_deletion(store):
    store.ingest_batch(
        [event(str(i), post(created=NOW - i * 60), did=f"did:plc:a{i}") for i in range(6)], NOW
    )
    first = store.feed_page(2, now=NOW)
    assert len(first["feed"]) == 2
    store.ingest_batch(
        [
            event("new", post(created=NOW + 1), did="did:plc:new", timestamp=NOW + 1),
            event("2", did="did:plc:a2", operation="delete", timestamp=NOW + 1),
        ],
        NOW + 1,
    )
    second = store.feed_page(2, first["cursor"], now=NOW + 2)
    third = store.feed_page(2, second["cursor"], now=NOW + 3)
    combined = first["feed"] + second["feed"] + third["feed"]
    assert len({item["post"] for item in combined}) == 5
    assert uri("2", "did:plc:a2") not in {item["post"] for item in combined}
    assert uri("new", "did:plc:new") not in {item["post"] for item in combined}
    assert "cursor" not in third


def test_deleted_post_is_removed_from_snapshot_immediately(store):
    store.ingest_batch([event("a", post()), event("b", post())], NOW)
    page = store.feed_page(1, now=NOW)
    deleted = uri("b") if page["feed"][0]["post"] == uri("a") else uri("a")
    store.ingest_batch(
        [event(deleted.rsplit("/", 1)[1], operation="delete", timestamp=NOW + 1)], NOW + 1
    )
    assert store.feed_page(1, page["cursor"], now=NOW + 1) == {"feed": []}


def test_snapshot_cannot_return_posts_that_have_aged_out(store):
    store.ingest_batch(
        [
            event("a", post(created=NOW - 3600)),
            event("b", post(created=NOW - 86400 + 10)),
        ],
        NOW,
    )
    page = store.feed_page(1, now=NOW)
    assert store.feed_page(1, page["cursor"], now=NOW + 11)["feed"] == []


def test_invalid_and_expired_cursor(store):
    store.ingest_batch([event("a", post()), event("b", post())], NOW)
    page = store.feed_page(1, now=NOW)
    with pytest.raises(InvalidCursor):
        store.feed_page(1, "garbage", now=NOW)
    tampered = "x" + page["cursor"][1:]
    with pytest.raises(InvalidCursor):
        store.feed_page(1, tampered, now=NOW)
    with pytest.raises(InvalidCursor, match="Expired"):
        store.feed_page(1, page["cursor"], now=NOW + 901)


def test_state_and_cursor_survive_restart(settings, tmp_path):
    settings = replace(settings, database_path=tmp_path / "db.sqlite")
    first = Store(settings)
    first.ingest_batch([event("a", post()), event("b", post())], NOW)
    page = first.feed_page(1, now=NOW)
    first.close()
    second = Store(settings)
    try:
        assert len(second.feed_page(1, page["cursor"], now=NOW + 1)["feed"]) == 1
        assert second.stream_cursor == int(NOW * 1_000_000)
    finally:
        second.close()


def test_account_deactivation_removes_posts_and_actor_engagement(store):
    store.ingest_batch(
        [
            event("a", post()),
            event("b", post(), did="did:plc:other"),
            react("l", uri("b", "did:plc:other"), actor=AUTHOR),
        ],
        NOW,
    )
    deactivation = {
        "kind": "account",
        "did": AUTHOR,
        "time_us": int((NOW + 1) * 1e6),
        "account": {"active": False},
    }
    store.ingest_batch([deactivation, event("a", post(), timestamp=NOW)], NOW + 1)
    assert store.ranked_posts(NOW + 1) == [uri("b", "did:plc:other")]
    assert store.stats()["interactions"] == 0
    reactivation = deactivation | {"time_us": int((NOW + 2) * 1e6), "account": {"active": True}}
    store.ingest_batch(
        [reactivation, deactivation, event("new", post(), timestamp=NOW + 3)], NOW + 3
    )
    assert uri("new") in store.ranked_posts(NOW + 3)


def test_prune_bounds_storage(store):
    store.ingest_batch([event("a", post()), react("l", uri("a"))], NOW)
    store.feed_page(1, now=NOW)
    store.prune(NOW + 86400 + 301)
    assert store.stats()["posts"] == 0
    assert store.stats()["interactions"] == 0
    assert store.db.execute("SELECT COUNT(*) FROM versions").fetchone()[0] == 0
    assert store.db.execute("SELECT COUNT(*) FROM snapshot_posts").fetchone()[0] == 0


def test_malformed_events_do_not_crash_or_poison_cursor(store):
    store.ingest_batch(
        [
            {},
            {"time_us": "not integer"},
            event("future", post(), timestamp=NOW + 1000),
            event("op", post()) | {"commit": {"collection": POST, "rkey": "a", "operation": []}},
            event("labels", post(labels={"values": [{"val": []}]})),
        ],
        NOW,
    )
    assert store.stream_cursor == int(NOW * 1e6)
    assert store.ranked_posts(NOW) == [uri("labels")]
