from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ParsedTransaction:
    transaction_id: str | None
    week: int
    type: str
    status: str
    roster_ids: list[int]
    adds: dict[str, int]
    drops: dict[str, int]
    bid: int | None
    faab_transfers: list[dict[str, int]] = field(default_factory=list)
    draft_picks: list[dict[str, Any]] = field(default_factory=list)


def _int_map(raw: dict[str, Any] | None) -> dict[str, int]:
    if not raw:
        return {}
    mapped: dict[str, int] = {}
    for key, value in raw.items():
        try:
            mapped[str(key)] = int(value)
        except (TypeError, ValueError):
            continue
    return mapped


def parse_transaction(raw: dict[str, Any], week: int) -> ParsedTransaction:
    settings = raw.get("settings") or {}
    bid = settings.get("waiver_bid")
    try:
        bid_val = int(bid) if bid is not None else None
    except (TypeError, ValueError):
        bid_val = None
    transfers = []
    for item in raw.get("waiver_budget") or []:
        try:
            transfers.append(
                {
                    "sender": int(item["sender"]),
                    "receiver": int(item["receiver"]),
                    "amount": int(item.get("amount") or 0),
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    roster_ids = []
    for value in raw.get("roster_ids") or []:
        try:
            roster_ids.append(int(value))
        except (TypeError, ValueError):
            continue
    return ParsedTransaction(
        transaction_id=str(raw.get("transaction_id")) if raw.get("transaction_id") else None,
        week=int(raw.get("leg") or week),
        type=str(raw.get("type") or "unknown"),
        status=str(raw.get("status") or ""),
        roster_ids=roster_ids,
        adds=_int_map(raw.get("adds")),
        drops=_int_map(raw.get("drops")),
        bid=bid_val,
        faab_transfers=transfers,
        draft_picks=list(raw.get("draft_picks") or []),
    )


def faab_spent_by_roster(transactions: list[ParsedTransaction]) -> dict[int, int]:
    spent: dict[int, int] = defaultdict(int)
    for txn in transactions:
        if txn.status != "complete":
            continue
        if txn.type == "waiver" and txn.bid:
            roster_id = next(iter(txn.adds.values()), None)
            if roster_id is None and txn.roster_ids:
                roster_id = txn.roster_ids[0]
            if roster_id is not None:
                spent[int(roster_id)] += txn.bid
        for transfer in txn.faab_transfers:
            spent[transfer["sender"]] += transfer["amount"]
            spent[transfer["receiver"]] -= transfer["amount"]
    return {roster_id: amount for roster_id, amount in spent.items() if amount > 0}


def serialize_transaction(txn: ParsedTransaction) -> dict[str, Any]:
    return {
        "transaction_id": txn.transaction_id,
        "week": txn.week,
        "type": txn.type,
        "status": txn.status,
        "roster_ids": txn.roster_ids,
        "adds": txn.adds,
        "drops": txn.drops,
        "bid": txn.bid,
        "faab_transfers": txn.faab_transfers,
        "draft_picks": txn.draft_picks,
    }
