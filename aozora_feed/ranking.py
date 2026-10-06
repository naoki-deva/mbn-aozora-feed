import math
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Any

WINDOW_SECONDS = 24 * 60 * 60
KANA_RE = re.compile(r"[\u3041-\u3096\u30a1-\u30fa\uff66-\uff9d]")
JAPANESE_RE = re.compile(r"[\u3041-\u3096\u30a1-\u30fa\u3400-\u9fff]")
# Broad indicators, not proof of a writer's physical location.
JAPAN_RE = re.compile(
    r"日本|国内|東京|大阪|京都|北海道|沖縄|福岡|名古屋|横浜|札幌|仙台|神戸|"
    r"広島|埼玉|千葉|茨城|静岡|長野|新潟|金沢|奈良|熊本|鹿児島|四国|九州|"
    r"東北|関東|関西|北陸|東海|山陰|山陽|青森|岩手|秋田|山形|福島|栃木|"
    r"群馬|神奈川|富山|石川|福井|山梨|岐阜|愛知|三重|滋賀|兵庫|和歌山|"
    r"鳥取|島根|岡山|山口|徳島|香川|愛媛|高知|佐賀|長崎|大分|宮崎|"
    r"\b(?:japan|japanese|tokyo|osaka|kyoto|hokkaido|okinawa)\b",
    re.IGNORECASE,
)
EXCLUDED_LABELS = {"!hide", "porn", "sexual", "nudity", "graphic-media"}


@dataclass(frozen=True)
class Signals:
    japanese: bool
    japan_topic: bool

    @property
    def eligible(self) -> bool:
        return self.japanese or self.japan_topic


def classify(record: dict[str, Any], include_japan_topics: bool = True) -> Signals:
    text = unicodedata.normalize("NFKC", str(record.get("text", "")))
    # URLs and mentions alone must not turn a foreign-language post into a Japan post.
    text = re.sub(r"https?://\S+|@[\w.-]+", " ", text)
    langs = record.get("langs", [])
    tagged = isinstance(langs, list) and any(
        isinstance(lang, str) and lang.lower().split("-")[0] == "ja" for lang in langs
    )
    letters = sum(character.isalpha() for character in text)
    inferred = len(KANA_RE.findall(text)) >= 2 and (
        len(JAPANESE_RE.findall(text)) / max(letters, 1) >= 0.15
    )
    return Signals(tagged or inferred, include_japan_topics and bool(JAPAN_RE.search(text)))


def has_excluded_labels(record: dict[str, Any]) -> bool:
    labels = record.get("labels", {})
    if not isinstance(labels, dict):
        return False
    values = labels.get("values", [])
    return isinstance(values, list) and any(
        isinstance(label, dict)
        and isinstance(label.get("val"), str)
        and label["val"] in EXCLUDED_LABELS
        for label in values
    )


def parse_timestamp(value: Any) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.timestamp()
    except (ValueError, OverflowError):
        return None


def score(
    *,
    age_hours: float,
    likes: int,
    reposts: int,
    replies: int,
    recent_likes: int,
    recent_reposts: int,
    recent_replies: int,
    japanese: bool,
    japan_topic: bool,
) -> float:
    """Unique actors per interaction kind; accelerate posts gaining attention now."""
    total = likes + 2.5 * reposts + 1.5 * replies
    recent = recent_likes + 2.5 * recent_reposts + 1.5 * recent_replies
    language_bonus = 1.2 if japanese else 1.0
    topic_bonus = 1.1 if japan_topic else 1.0
    return (
        (1.0 + math.log1p(total) + 1.5 * math.log1p(recent))
        / (max(age_hours, 0) + 2.0) ** 1.15
        * language_bonus
        * topic_bonus
    )
