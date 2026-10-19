-- Templates (saved day/week plans) and routines (recurring plan blocks).

CREATE TABLE templates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  span_days  INTEGER NOT NULL CHECK (span_days IN (1, 7)),
  blocks     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(blocks)), -- JSON TemplateBlock[]
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE routines (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL DEFAULT '',
  goal_id              TEXT REFERENCES goals(id) ON DELETE SET NULL,
  notes                TEXT NOT NULL DEFAULT '',
  start_minute         INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute           INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  weekdays             INTEGER NOT NULL CHECK (weekdays BETWEEN 1 AND 127),
  starts_on            TEXT NOT NULL CHECK (starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  ends_on              TEXT CHECK (ends_on IS NULL OR ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  materialized_through TEXT CHECK (materialized_through IS NULL OR materialized_through GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  CHECK (end_minute > start_minute),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
) STRICT;

ALTER TABLE blocks ADD COLUMN routine_id TEXT REFERENCES routines(id) ON DELETE SET NULL;

CREATE INDEX blocks_routine ON blocks (routine_id, day) WHERE routine_id IS NOT NULL;
