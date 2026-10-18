-- Timeblock schema v1. Times are wall-clock: day 'YYYY-MM-DD' + minutes since midnight.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL -- JSON
) STRICT, WITHOUT ROWID;

CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  color       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'min' CHECK (kind IN ('min', 'max')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_on TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE week_targets (
  goal_id        TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  week_start     TEXT NOT NULL,
  target_minutes INTEGER CHECK (target_minutes IS NULL OR target_minutes BETWEEN 0 AND 10080), -- NULL = tracked only
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (goal_id, week_start)
) STRICT, WITHOUT ROWID;

CREATE TABLE checklist_items (
  id              TEXT PRIMARY KEY,
  goal_id         TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  week_start      TEXT NOT NULL,
  text            TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  done            INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  carried_from_id TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE TABLE blocks (
  id            TEXT PRIMARY KEY,
  day           TEXT NOT NULL,
  layer         TEXT NOT NULL CHECK (layer IN ('plan', 'actual')),
  start_minute  INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute    INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  title         TEXT NOT NULL DEFAULT '',
  goal_id       TEXT REFERENCES goals(id) ON DELETE SET NULL,
  notes         TEXT NOT NULL DEFAULT '',
  plan_block_id TEXT REFERENCES blocks(id) ON DELETE SET NULL,
  skipped       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  CHECK (end_minute > start_minute),
  CHECK (layer = 'actual' OR plan_block_id IS NULL),
  CHECK (layer = 'plan' OR skipped = 0)
) STRICT;

CREATE TABLE week_notes (
  week_start TEXT PRIMARY KEY,
  text       TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX blocks_day_layer ON blocks (day, layer, start_minute);
CREATE INDEX blocks_plan_link ON blocks (plan_block_id) WHERE plan_block_id IS NOT NULL;
CREATE INDEX blocks_goal ON blocks (goal_id);
CREATE INDEX checklist_week ON checklist_items (week_start, goal_id, sort_order);
