import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse

from .config import Settings
from .store import InvalidCursor, Store
from .stream import JetstreamConsumer

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store = Store(settings)
        store.prune()
        consumer = JetstreamConsumer(settings, store)
        app.state.store = store
        app.state.consumer = consumer
        task = asyncio.create_task(consumer.run()) if settings.stream_enabled else None
        app.state.stream_task = task
        if not settings.public_configured:
            logger.warning(
                "Local configuration: set FEED_HOSTNAME and FEED_PUBLISHER_DID to publish"
            )
        try:
            yield
        finally:
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    try:
                        await task
                    except Exception:
                        logger.exception("Jetstream consumer stopped with an error")
            store.close()

    app = FastAPI(title="あおぞら — 日本のいま", version="0.1.0", lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, _error):
        return JSONResponse(
            status_code=400,
            content={
                "error": "InvalidRequest",
                "message": "feed is required; limit must be an integer 1-100",
            },
        )

    @app.get("/.well-known/did.json")
    async def did_document():
        return {
            "@context": ["https://www.w3.org/ns/did/v1"],
            "id": settings.service_did,
            "service": [
                {
                    "id": "#bsky_fg",
                    "type": "BskyFeedGenerator",
                    "serviceEndpoint": f"https://{settings.hostname}",
                }
            ],
        }

    @app.get("/xrpc/app.bsky.feed.describeFeedGenerator")
    async def describe():
        return {"did": settings.service_did, "feeds": [{"uri": settings.feed_uri}]}

    @app.get("/xrpc/app.bsky.feed.getFeedSkeleton")
    async def skeleton(
        feed: str = Query(max_length=512),
        limit: int = Query(default=50, ge=1, le=100),
        cursor: str | None = Query(default=None, max_length=200),
    ):
        if feed != settings.feed_uri:
            return JSONResponse(
                status_code=400,
                content={
                    "error": "UnknownFeed",
                    "message": "This service does not provide the requested feed",
                },
            )
        try:
            return app.state.store.feed_page(limit, cursor)
        except InvalidCursor as error:
            return JSONResponse(
                status_code=400,
                content={
                    "error": "InvalidRequest",
                    "message": str(error),
                },
            )

    @app.get("/healthz")
    async def health():
        consumer = app.state.consumer.status()
        task = app.state.stream_task
        failed = bool(task and task.done())
        healthy = not settings.stream_enabled or (consumer["caught_up"] and not failed)
        return JSONResponse(
            status_code=200 if healthy else 503,
            content={
                "status": "ok" if healthy else "warming_up_or_degraded",
                "public_configured": settings.public_configured,
                "stream": consumer,
                "consumer_failed": failed,
                "database": app.state.store.stats(),
            },
        )

    @app.get("/livez")
    async def live():
        return {"status": "ok"}

    @app.get("/", response_class=HTMLResponse)
    async def home():
        return """<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>あおぞら — 日本のいま</title>
<style>body{font-family:system-ui,sans-serif;max-width:680px;margin:12vh auto;
padding:24px;line-height:1.9;color:#17324d;background:#f4f9ff}
h1{font-size:2rem}a{color:#087bc1}</style>
<main><p>BLUESKY CUSTOM FEED</p><h1>あおぞら — 日本のいま</h1>
<p>日本語と日本に関する話題を中心に、直近24時間の投稿をお届けします。
話題の投稿に、まだ反応が少ない投稿者の新着も混ぜてお届けします。</p>
<p>日本語の言語タグや本文、日本の地域名などを目安に選んでいます。
投稿者が日本国内にいることを保証するものではありません。</p>
<p><a href="/xrpc/app.bsky.feed.describeFeedGenerator">フィード情報</a>
 · <a href="/healthz">稼働状況</a></p></main></html>"""

    return app
