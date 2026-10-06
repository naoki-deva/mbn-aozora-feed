import logging
import os

import uvicorn
from dotenv import load_dotenv


def main() -> None:
    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # SQLite + the collector must run in one process, without reload or multiple workers.
    uvicorn.run(
        "aozora_feed.api:create_app",
        factory=True,
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        workers=1,
    )


if __name__ == "__main__":
    main()
