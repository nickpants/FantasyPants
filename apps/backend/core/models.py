from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON, Uuid

from core.database import Base

JSONType = JSON().with_variant(JSONB, "postgresql")
UUIDType = Uuid(as_uuid=True).with_variant(PGUUID(as_uuid=True), "postgresql")


class SleeperPlayer(Base):
    __tablename__ = "sleeper_players"

    player_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    position: Mapped[str] = mapped_column(String(10), nullable=False)
    nfl_team: Mapped[str | None] = mapped_column(String(10))
    injury_status: Mapped[str | None] = mapped_column(String(50))
    injury_body_part: Mapped[str | None] = mapped_column(String(100))
    injury_notes: Mapped[str | None] = mapped_column(Text)
    depth_chart_order: Mapped[int | None] = mapped_column(Integer)
    depth_chart_position: Mapped[str | None] = mapped_column(String(10))
    years_exp: Mapped[int | None] = mapped_column(Integer)
    age: Mapped[float | None] = mapped_column(Numeric(4, 1))
    status: Mapped[str | None] = mapped_column(String(50))
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONType)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AppUser(Base):
    __tablename__ = "app_users"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    sleeper_username: Mapped[str | None] = mapped_column(String(100))
    sleeper_user_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SleeperLeague(Base):
    __tablename__ = "sleeper_leagues"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    sleeper_league_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    season: Mapped[str] = mapped_column(String(10), nullable=False)
    total_rosters: Mapped[int] = mapped_column(Integer, nullable=False)
    roster_positions: Mapped[list[Any]] = mapped_column(JSONType, nullable=False)
    scoring_settings: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    settings: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    is_dynasty: Mapped[bool] = mapped_column(Boolean, default=False)
    avatar: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str | None] = mapped_column(String(50))
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SleeperRoster(Base):
    __tablename__ = "sleeper_rosters"
    __table_args__ = (UniqueConstraint("league_id", "roster_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    league_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("sleeper_leagues.sleeper_league_id", ondelete="CASCADE")
    )
    roster_id: Mapped[int] = mapped_column(Integer, nullable=False)
    owner_id: Mapped[str | None] = mapped_column(String(64))
    team_name: Mapped[str | None] = mapped_column(String(255))
    players: Mapped[list[str] | None] = mapped_column(JSONType)
    starters: Mapped[list[str] | None] = mapped_column(JSONType)
    reserve: Mapped[list[str] | None] = mapped_column(JSONType)
    taxi: Mapped[list[str] | None] = mapped_column(JSONType)
    waiver_budget_used: Mapped[int] = mapped_column(Integer, default=0)
    total_faab: Mapped[int] = mapped_column(Integer, default=100)
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SleeperWeeklyMatchup(Base):
    __tablename__ = "sleeper_weekly_matchups"
    __table_args__ = (UniqueConstraint("league_id", "week", "roster_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    league_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("sleeper_leagues.sleeper_league_id", ondelete="CASCADE")
    )
    week: Mapped[int] = mapped_column(Integer, nullable=False)
    matchup_id: Mapped[int | None] = mapped_column(Integer)
    roster_id: Mapped[int] = mapped_column(Integer, nullable=False)
    points: Mapped[float | None] = mapped_column(Numeric(6, 2))
    starters: Mapped[list[str] | None] = mapped_column(JSONType)
    starters_points: Mapped[list[Any] | None] = mapped_column(JSONType)
    players: Mapped[list[str] | None] = mapped_column(JSONType)
    players_points: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    projected_median: Mapped[float | None] = mapped_column(Numeric(6, 2))
    projected_floor: Mapped[float | None] = mapped_column(Numeric(6, 2))
    projected_ceiling: Mapped[float | None] = mapped_column(Numeric(6, 2))
    win_probability: Mapped[float | None] = mapped_column(Numeric(4, 3))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class QualitativeBeatIntel(Base):
    __tablename__ = "qualitative_beat_intel"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    player_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("sleeper_players.player_id"))
    source: Mapped[str | None] = mapped_column(String(100))
    report_text: Mapped[str] = mapped_column(Text, nullable=False)
    impact_level: Mapped[str | None] = mapped_column(String(20))
    practice_status: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
