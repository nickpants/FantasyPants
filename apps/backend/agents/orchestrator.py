from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any, TypedDict

from agents.context import pack_context, pack_trade_context
from agents.heuristic import (
    ceiling_brief,
    floor_brief,
    injury_brief,
    master_brief,
    master_trade_brief,
    trade_brief,
)
from agents.llm import LLMNotConfigured, complete, complete_stream, llm_configured
from agents.prompts import (
    CEILING_SYSTEM,
    FLOOR_SYSTEM,
    INJURY_SYSTEM,
    MASTER_SYSTEM,
    MASTER_TRADE_SYSTEM,
    TRADE_SYSTEM,
)
from core.config import get_settings


class CoachState(TypedDict, total=False):
    context: str
    bias: str
    packed: dict[str, Any]
    floor: str
    ceiling: str
    injury: str
    trade: str
    master: str


async def _specialist(system: str, packed: dict[str, Any], fallback) -> str:
    if llm_configured():
        try:
            return await complete(system, packed["text"])
        except Exception as exc:  # noqa: BLE001 — copilot must still answer
            return fallback(packed) + f"\n(LLM fallback: {exc})"
    return fallback(packed)


async def floor_node(state: CoachState) -> dict[str, str]:
    return {"floor": await _specialist(FLOOR_SYSTEM, state["packed"], floor_brief)}


async def ceiling_node(state: CoachState) -> dict[str, str]:
    return {"ceiling": await _specialist(CEILING_SYSTEM, state["packed"], ceiling_brief)}


async def injury_node(state: CoachState) -> dict[str, str]:
    return {"injury": await _specialist(INJURY_SYSTEM, state["packed"], injury_brief)}


async def trade_node(state: CoachState) -> dict[str, str]:
    packed = state["packed"]
    if packed.get("topic") != "trade":
        return {"trade": ""}
    return {"trade": await _specialist(TRADE_SYSTEM, packed, trade_brief)}


async def master_node(state: CoachState) -> dict[str, str]:
    packed = state["packed"]
    user = (
        packed["text"]
        + "\n\nFloor Conservator:\n"
        + state.get("floor", "")
        + "\n\nCeiling Gambler:\n"
        + state.get("ceiling", "")
        + "\n\nInjury Agent:\n"
        + state.get("injury", "")
        + "\n\nTrade Arbiter:\n"
        + state.get("trade", "")
        + f"\n\nBias instruction: {packed['bias']}"
    )
    trade_topic = packed.get("topic") == "trade"
    system = MASTER_TRADE_SYSTEM if trade_topic else MASTER_SYSTEM
    if llm_configured():
        try:
            return {"master": await complete(system, user, max_tokens=500)}
        except Exception:
            pass
    if trade_topic:
        return {
            "master": master_trade_brief(
                packed,
                state.get("floor", ""),
                state.get("ceiling", ""),
                state.get("injury", ""),
                state.get("trade", ""),
            )
        }
    return {
        "master": master_brief(
            packed,
            state.get("floor", ""),
            state.get("ceiling", ""),
            state.get("injury", ""),
        )
    }


def build_graph():
    from langgraph.graph import END, START, StateGraph

    graph = StateGraph(CoachState)
    graph.add_node("floor", floor_node)
    graph.add_node("ceiling", ceiling_node)
    graph.add_node("injury", injury_node)
    graph.add_node("trade", trade_node)
    graph.add_node("master", master_node)
    graph.add_edge(START, "floor")
    graph.add_edge(START, "ceiling")
    graph.add_edge(START, "injury")
    graph.add_edge(START, "trade")
    graph.add_edge("floor", "master")
    graph.add_edge("ceiling", "master")
    graph.add_edge("injury", "master")
    graph.add_edge("trade", "master")
    graph.add_edge("master", END)
    return graph.compile()


_GRAPH = None


def get_graph():
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_graph()
    return _GRAPH


async def run_debate(
    lineup: dict[str, Any],
    flags: list[dict[str, Any]] | None = None,
    question: str | None = None,
    beat_intel: list[dict[str, Any]] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    packed = pack_context(lineup, flags, question, beat_intel)
    settings = get_settings()
    source = settings.xai_model if llm_configured() else "heuristic"
    yield {
        "type": "status",
        "source": source,
        "bias": packed["bias"],
        "configured": llm_configured(),
        "model": settings.xai_model,
    }
    initial: CoachState = {
        "context": packed["text"],
        "bias": packed["bias"],
        "packed": packed,
    }
    graph = get_graph()
    async for update in graph.astream(initial, stream_mode="updates"):
        for node, payload in update.items():
            if node == "master":
                text = payload.get("master") or ""
                if llm_configured():
                    # already completed as a block; still emit as master
                    yield {"type": "agent", "agent": "master", "text": text, "source": source}
                else:
                    yield {"type": "agent", "agent": "master", "text": text, "source": source}
            elif node in {"floor", "ceiling", "injury", "trade"}:
                text = payload.get(node) or ""
                if node == "trade" and not text:
                    continue
                yield {
                    "type": "agent",
                    "agent": node,
                    "text": text,
                    "source": source,
                }
    yield {"type": "done", "source": source}


async def run_trade_debate(
    grade: dict[str, Any],
    *,
    flags: list[dict[str, Any]] | None = None,
    beat_intel: list[dict[str, Any]] | None = None,
    remaining_faab: int | None = None,
    win_probability: float | None = None,
    question: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    packed = pack_trade_context(
        grade,
        flags=flags,
        beat_intel=beat_intel,
        remaining_faab=remaining_faab,
        win_probability=win_probability,
        question=question,
    )
    settings = get_settings()
    source = settings.xai_model if llm_configured() else "heuristic"
    yield {
        "type": "status",
        "source": source,
        "bias": packed["bias"],
        "configured": llm_configured(),
        "model": settings.xai_model,
        "topic": "trade",
    }
    initial: CoachState = {
        "context": packed["text"],
        "bias": packed["bias"],
        "packed": packed,
    }
    graph = get_graph()
    async for update in graph.astream(initial, stream_mode="updates"):
        for node, payload in update.items():
            if node in {"floor", "ceiling", "injury", "trade", "master"}:
                text = payload.get(node) or ""
                if node == "trade" and not text:
                    continue
                yield {"type": "agent", "agent": node, "text": text, "source": source}
    yield {"type": "done", "source": source, "topic": "trade"}


async def stream_master_only(packed: dict[str, Any], floor: str, ceiling: str, injury: str) -> AsyncIterator[str]:
    user = packed["text"] + f"\n\nFloor:\n{floor}\n\nCeiling:\n{ceiling}\n\nInjury:\n{injury}"
    try:
        async for delta in complete_stream(MASTER_SYSTEM, user):
            yield delta
    except LLMNotConfigured:
        yield master_brief(packed, floor, ceiling, injury)
