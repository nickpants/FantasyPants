from __future__ import annotations

from services.sleeper.client import SleeperClient

_client: SleeperClient | None = None


def set_client(client: SleeperClient | None) -> None:
    global _client
    _client = client


def get_client() -> SleeperClient:
    if _client is None:
        raise RuntimeError("Sleeper client is not initialized")
    return _client
