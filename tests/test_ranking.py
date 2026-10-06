import pytest

from aozora_feed.ranking import classify, has_excluded_labels, parse_timestamp, score


@pytest.mark.parametrize(
    ("record", "japanese", "japan_topic"),
    [
        ({"text": "今日は青空がきれいですね"}, True, False),
        ({"text": "ｶﾀｶﾅで投稿します"}, True, False),
        ({"text": "I love Tokyo"}, False, True),
        ({"text": "日本のニュース", "langs": ["ja"]}, True, True),
        ({"text": "東京駅", "langs": ["ja-JP"]}, True, True),
        ({"text": "hello world", "langs": ["en"]}, False, False),
        ({"text": "hello https://tokyo.example.jp @japan.bsky.social"}, False, False),
        ({"text": "京都"}, False, True),
        ({"text": "世界经济增长", "langs": ["zh"]}, False, False),
        ({"text": "你好东京"}, False, False),
        ({"text": "hello", "langs": None}, False, False),
        ({"text": "a" * 100 + "あい"}, False, False),
    ],
)
def test_language_and_topic_detection(record, japanese, japan_topic):
    result = classify(record)
    assert result.japanese is japanese
    assert result.japan_topic is japan_topic


def test_japan_topic_can_be_disabled():
    assert not classify({"text": "Kyoto is beautiful"}, False).eligible
    assert classify({"text": "きれいな青空です"}, False).eligible


def test_labels():
    assert has_excluded_labels({"labels": {"values": [{"val": "porn"}]}})
    assert not has_excluded_labels({"labels": {"values": [{"val": []}]}})
    assert not has_excluded_labels({"labels": {"values": [{"val": "other"}]}})


@pytest.mark.parametrize("value", [None, "nonsense", "2026-01-01T00:00:00", 123])
def test_timestamp_requires_timezone(value):
    assert parse_timestamp(value) is None


def test_rank_rewards_momentum_and_freshness():
    base = dict(
        age_hours=2,
        likes=10,
        reposts=2,
        replies=1,
        recent_likes=0,
        recent_reposts=0,
        recent_replies=0,
        japanese=True,
        japan_topic=False,
    )
    baseline = score(**base)
    assert score(**(base | {"recent_likes": 10})) > baseline
    assert score(**(base | {"age_hours": 1})) > baseline
    assert score(**(base | {"japan_topic": True})) > baseline
    assert score(**(base | {"japanese": False})) < baseline
