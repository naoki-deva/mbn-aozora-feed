import json
from dataclasses import replace

import pytest

from aozora_feed import publish


@pytest.mark.parametrize("percent", [0, 30, 40])
def test_registration_preview_describes_configured_mix_without_network(
    settings,
    monkeypatch,
    capsys,
    percent,
):
    settings = replace(
        settings,
        hostname="feeds.aozora.test",
        publisher_did="did:plc:author",
        discovery_percent=percent,
    )
    monkeypatch.setattr(publish.Settings, "from_env", lambda: settings)
    monkeypatch.setattr("sys.argv", ["aozora-publish"])

    def reject_network(**_):
        raise AssertionError("Preview must not connect to the PDS")

    monkeypatch.setattr(publish.httpx, "Client", reject_network)
    publish.main()
    preview, _ = json.JSONDecoder().raw_decode(capsys.readouterr().out)
    description = preview["record"]["description"]
    assert "直近24時間" in description
    if percent:
        assert f"約{percent}%" in description
    else:
        assert "%" not in description
