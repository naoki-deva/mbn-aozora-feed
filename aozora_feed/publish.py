"""Explicit command to register the completed service in the publisher's PDS."""

import argparse
import json
import os
from datetime import UTC, datetime

import httpx

from .config import Settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Blueskyにあおぞらフィードを登録する")
    parser.add_argument("--apply", action="store_true", help="実際にPDSへ登録（既存同名を更新）")
    args = parser.parse_args()
    settings = Settings.from_env()
    if not settings.public_configured or "example.com" in settings.hostname:
        parser.error("実際のFEED_HOSTNAMEとFEED_PUBLISHER_DIDを設定してください")
    record = {
        "$type": "app.bsky.feed.generator",
        "did": settings.service_did,
        "displayName": "あおぞら — 日本のいま",
        "description": (
            "日本語・日本の話題を中心に、直近24時間の投稿をピックアップ。"
            + (
                f"話題の投稿に、まだ注目されていない投稿者の新着も約{settings.discovery_percent}%混ぜます。"
                if settings.discovery_percent
                else "反応の勢いと新しさで並べます。"
            )
            + "日本語・地域名などを目安にしており、国内所在地を保証しません。"
        ),
        "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
    body = {
        "repo": settings.publisher_did,
        "collection": "app.bsky.feed.generator",
        "rkey": settings.feed_rkey,
        "record": record,
    }
    if not args.apply:
        print(json.dumps(body, ensure_ascii=False, indent=2))
        print("確認後、aozora-publish --apply で登録できます。")
        return
    identifier, password = os.getenv("BSKY_IDENTIFIER"), os.getenv("BSKY_APP_PASSWORD")
    if not identifier or not password:
        parser.error("BSKY_IDENTIFIERとBSKY_APP_PASSWORDを設定してください")
    service = os.getenv("BSKY_SERVICE", "https://bsky.social").rstrip("/")
    if not service.startswith("https://"):
        parser.error("BSKY_SERVICEにはHTTPSのPDS URLを指定してください")
    try:
        with httpx.Client(timeout=30) as client:
            # Verify the deployed DID and feed before writing the publisher's repository.
            deployed = client.get(f"https://{settings.hostname}/.well-known/did.json")
            deployed.raise_for_status()
            document = deployed.json()
            if document.get("id") != settings.service_did or not any(
                entry.get("type") == "BskyFeedGenerator"
                and entry.get("serviceEndpoint") == f"https://{settings.hostname}"
                for entry in document.get("service", [])
            ):
                parser.error("公開DIDドキュメントが設定と一致しません")
            check = client.get(
                f"https://{settings.hostname}/xrpc/app.bsky.feed.getFeedSkeleton",
                params={"feed": settings.feed_uri, "limit": 1},
            )
            check.raise_for_status()
            if not isinstance(check.json().get("feed"), list):
                parser.error("公開フィードAPIの応答が不正です")
            readiness = client.get(f"https://{settings.hostname}/healthz")
            readiness.raise_for_status()
            session = client.post(
                f"{service}/xrpc/com.atproto.server.createSession",
                json={
                    "identifier": identifier,
                    "password": password,
                },
            )
            session.raise_for_status()
            auth = session.json()
            if auth["did"] != settings.publisher_did:
                parser.error("ログインアカウントとFEED_PUBLISHER_DIDが一致しません")
            response = client.post(
                f"{service}/xrpc/com.atproto.repo.putRecord",
                json=body,
                headers={"Authorization": f"Bearer {auth['accessJwt']}"},
            )
            response.raise_for_status()
            print(f"登録完了: {response.json()['uri']}")
            print(f"https://bsky.app/profile/{settings.publisher_did}/feed/{settings.feed_rkey}")
    except (httpx.HTTPError, KeyError, ValueError) as error:
        # Never dump login responses or credentials on a failed request.
        parser.exit(
            1, f"登録失敗: {type(error).__name__}。設定と公開サービスを確認してください。\n"
        )


if __name__ == "__main__":
    main()
