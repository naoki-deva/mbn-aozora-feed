from collections import Counter
from dataclasses import replace

import pytest
from conftest import NOW, event, post, stamp, uri

from aozora_feed.config import Settings
from aozora_feed.store import LIKE, Store


def add_reactions(store, target, count):
    store.ingest_batch(
        [
            event(
                f"reaction-{index}-{target.split('/')[2]}-{target.rsplit('/', 1)[1]}",
                {"subject": {"uri": target}, "createdAt": stamp(NOW - 10)},
                did=f"did:plc:reader{index}",
                collection=LIKE,
            )
            for index in range(count)
        ],
        NOW,
    )


def seed_trending(store):
    for index in range(12):
        author = f"did:plc:hot{index}"
        store.ingest_batch([event("hot", post(), did=author)], NOW)
        add_reactions(store, uri("hot", author), 6)


def seed_quiet(store, count=6):
    store.ingest_batch(
        [
            event("quiet", post(created=NOW - 60 - index), did=f"did:plc:quiet{index}")
            for index in range(count)
        ],
        NOW,
    )


def test_zero_reaction_newcomers_get_three_of_first_ten_slots(store):
    seed_trending(store)
    seed_quiet(store)
    first_ten = store.ranked_posts(NOW)[:10]
    assert [first_ten[index] for index in (3, 6, 9)] == [
        uri("quiet", f"did:plc:quiet{index}") for index in range(3)
    ]
    assert sum("did:plc:quiet" in item for item in first_ten) == 3
    assert len(first_ten) == len(set(first_ten))


@pytest.mark.parametrize("reason", ["too_old", "too_many_reactions", "popular_author"])
def test_discovery_excludes_old_popular_posts_and_popular_authors(store, reason):
    seed_trending(store)
    seed_quiet(store)
    author = "did:plc:excluded"
    created = NOW - (3 * 3600 + 1) if reason == "too_old" else NOW - 1
    store.ingest_batch([event("excluded", post(created=created), did=author)], NOW)
    if reason == "too_many_reactions":
        add_reactions(store, uri("excluded", author), 6)
    elif reason == "popular_author":
        store.ingest_batch([event("older", post(created=NOW - 7200), did=author)], NOW)
        add_reactions(store, uri("older", author), 21)
    ranked = store.ranked_posts(NOW)
    assert [ranked[index] for index in (3, 6, 9)] == [
        uri("quiet", f"did:plc:quiet{index}") for index in range(3)
    ]


def test_discovery_gives_other_authors_a_turn_before_repeat_posts(store):
    seed_trending(store)
    store.ingest_batch(
        [
            *[
                event(f"quiet-{index}", post(created=NOW - index), did="did:plc:frequent")
                for index in range(8)
            ],
            event("quiet", post(created=NOW - 100), did="did:plc:other"),
        ],
        NOW,
    )
    ranked = store.ranked_posts(NOW)
    assert ranked[3] == uri("quiet-0", "did:plc:frequent")
    assert ranked[6] == uri("quiet", "did:plc:other")
    counts = Counter(item.split("/")[2] for item in ranked)
    assert max(counts.values()) <= 3
    assert len(ranked) == len(set(ranked))


@pytest.mark.parametrize("percent", [0, 100])
def test_discovery_percentage_can_be_disabled_or_prioritized(settings, percent):
    store = Store(replace(settings, discovery_percent=percent))
    try:
        seed_trending(store)
        seed_quiet(store)
        first_ten = store.ranked_posts(NOW)[:10]
        if percent == 0:
            assert all("did:plc:hot" in item for item in first_ten)
        else:
            assert all("did:plc:quiet" in item for item in first_ten[:6])
            # When the discovery queue empties, fill the rest with ranked posts.
            assert all("did:plc:hot" in item for item in first_ten[6:])
    finally:
        store.close()


def test_all_quiet_posts_are_returned_without_duplicates(store):
    seed_quiet(store)
    ranked = store.ranked_posts(NOW)
    assert len(ranked) == 6
    assert len(set(ranked)) == 6


def test_mixing_is_preserved_across_short_pages(store):
    seed_trending(store)
    seed_quiet(store)
    ranked = store.ranked_posts(NOW)
    combined = []
    cursor = None
    while True:
        page = store.feed_page(3, cursor, now=NOW)
        combined.extend(item["post"] for item in page["feed"])
        cursor = page.get("cursor")
        if not cursor:
            break
    assert combined == ranked
    assert combined[3] == uri("quiet", "did:plc:quiet0")


def test_discovery_includes_age_and_reaction_threshold_boundaries(settings):
    store = Store(replace(settings, discovery_percent=100))
    try:
        seed_trending(store)
        author = "did:plc:boundary"
        store.ingest_batch([event("quiet", post(created=NOW - 3 * 3600), did=author)], NOW)
        add_reactions(store, uri("quiet", author), 5)
        assert store.ranked_posts(NOW)[0] == uri("quiet", author)
    finally:
        store.close()


@pytest.mark.parametrize(
    "changes",
    [
        {"discovery_percent": -1},
        {"discovery_percent": 101},
        {"discovery_max_age_hours": 0},
        {"discovery_max_age_hours": 25},
        {"discovery_max_interactions": -1},
        {"discovery_max_author_interactions": -1},
    ],
)
def test_discovery_settings_validate_bounds(changes):
    with pytest.raises(ValueError):
        replace(Settings(), **changes)


def test_discovery_environment_settings_are_loaded(monkeypatch):
    monkeypatch.setenv("DISCOVERY_PERCENT", "40")
    monkeypatch.setenv("DISCOVERY_MAX_AGE_HOURS", "2")
    monkeypatch.setenv("DISCOVERY_MAX_INTERACTIONS", "0")
    monkeypatch.setenv("DISCOVERY_MAX_AUTHOR_INTERACTIONS", "10")
    settings = Settings.from_env()
    assert settings.discovery_percent == 40
    assert settings.discovery_max_age_hours == 2
    assert settings.discovery_max_interactions == 0
    assert settings.discovery_max_author_interactions == 10
