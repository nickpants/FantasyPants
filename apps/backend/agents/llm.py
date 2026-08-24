from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path

from core.config import ROOT, get_settings


class LLMNotConfigured(RuntimeError):
    pass


def _stored_key(settings=None) -> str | None:
    settings = settings or get_settings()
    return settings.xai_api_key or settings.grok_code_xai_api_key or settings.grok_api_key


def llm_configured() -> bool:
    return bool(_stored_key())


def _api_key() -> str | None:
    return _stored_key()


async def complete(system: str, user: str, *, max_tokens: int = 400) -> str:
    settings = get_settings()
    key = _api_key()
    if not key:
        raise LLMNotConfigured("XAI_API_KEY is not set")
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=key, base_url=settings.xai_base_url)
    response = await client.chat.completions.create(
        model=settings.xai_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=max_tokens,
        temperature=0.4,
    )
    return (response.choices[0].message.content or "").strip()


async def complete_stream(system: str, user: str, *, max_tokens: int = 500) -> AsyncIterator[str]:
    settings = get_settings()
    key = _api_key()
    if not key:
        raise LLMNotConfigured("XAI_API_KEY is not set")
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=key, base_url=settings.xai_base_url)
    stream = await client.chat.completions.create(
        model=settings.xai_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=max_tokens,
        temperature=0.4,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            yield delta


def persist_xai_key(api_key: str) -> None:
    key = api_key.strip()
    if not key.startswith("xai-"):
        raise ValueError("Expected an xAI key starting with xai-")
    os.environ["XAI_API_KEY"] = key
    path: Path = ROOT / ".env"
    try:
        lines = path.read_text() if path.exists() else ""
        updated = False
        out = []
        for line in lines.splitlines():
            if line.startswith("XAI_API_KEY="):
                out.append(f"XAI_API_KEY={key}")
                updated = True
            else:
                out.append(line)
        if not updated:
            if out and out[-1] != "":
                out.append("")
            out.append(f"XAI_API_KEY={key}")
        path.write_text("\n".join(out) + "\n")
    except OSError:
        # grok.me / container filesystems may be ephemeral or read-only.
        pass
    get_settings.cache_clear()
