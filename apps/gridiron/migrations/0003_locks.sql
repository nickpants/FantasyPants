-- Kickoff timestamps on the weekly slate (bye/lock). Opportunity stays in-memory.
alter table nfl_games add column if not exists gametime text;
alter table nfl_games add column if not exists kickoff_ms bigint;
