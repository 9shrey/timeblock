-- Integrity checks the v1 tables lack. SQLite can't add CHECKs to an existing table, and
-- rebuilding goals would fire its ON DELETE CASCADEs, so the rules are BEFORE triggers.
-- Existing rows are not re-validated; writes from now on are.

CREATE TRIGGER goals_valid_insert BEFORE INSERT ON goals
WHEN NEW.color NOT GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]' OR (NEW.archived_on IS NOT NULL AND NEW.archived_on NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
BEGIN SELECT RAISE(ABORT, 'goals: color must be #rrggbb and archived_on YYYY-MM-DD'); END;

CREATE TRIGGER goals_valid_update BEFORE UPDATE OF color, archived_on ON goals
WHEN NEW.color NOT GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]' OR (NEW.archived_on IS NOT NULL AND NEW.archived_on NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
BEGIN SELECT RAISE(ABORT, 'goals: color must be #rrggbb and archived_on YYYY-MM-DD'); END;

CREATE TRIGGER blocks_valid_insert BEFORE INSERT ON blocks
WHEN NEW.skipped NOT IN (0, 1) OR NEW.day NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
BEGIN SELECT RAISE(ABORT, 'blocks: skipped must be 0/1 and day YYYY-MM-DD'); END;

CREATE TRIGGER blocks_valid_update BEFORE UPDATE OF skipped, day ON blocks
WHEN NEW.skipped NOT IN (0, 1) OR NEW.day NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
BEGIN SELECT RAISE(ABORT, 'blocks: skipped must be 0/1 and day YYYY-MM-DD'); END;

CREATE TRIGGER checklist_valid_insert BEFORE INSERT ON checklist_items
WHEN NEW.done NOT IN (0, 1) OR NEW.week_start NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
BEGIN SELECT RAISE(ABORT, 'checklist_items: done must be 0/1 and week_start YYYY-MM-DD'); END;

CREATE TRIGGER checklist_valid_update BEFORE UPDATE OF done, week_start ON checklist_items
WHEN NEW.done NOT IN (0, 1) OR NEW.week_start NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
BEGIN SELECT RAISE(ABORT, 'checklist_items: done must be 0/1 and week_start YYYY-MM-DD'); END;

CREATE TRIGGER week_targets_valid_insert BEFORE INSERT ON week_targets
WHEN NEW.week_start NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
BEGIN SELECT RAISE(ABORT, 'week_targets: week_start must be YYYY-MM-DD'); END;

CREATE TRIGGER week_targets_valid_update BEFORE UPDATE OF week_start ON week_targets
WHEN NEW.week_start NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
BEGIN SELECT RAISE(ABORT, 'week_targets: week_start must be YYYY-MM-DD'); END;

CREATE TRIGGER week_notes_valid_insert BEFORE INSERT ON week_notes
WHEN NEW.week_start NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
BEGIN SELECT RAISE(ABORT, 'week_notes: week_start must be YYYY-MM-DD'); END;

CREATE TRIGGER week_notes_valid_update BEFORE UPDATE OF week_start ON week_notes
WHEN NEW.week_start NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
BEGIN SELECT RAISE(ABORT, 'week_notes: week_start must be YYYY-MM-DD'); END;

-- Most blocks have a goal, but unassigned ones needn't be indexed.
DROP INDEX blocks_goal;
CREATE INDEX blocks_goal ON blocks (goal_id) WHERE goal_id IS NOT NULL;

-- Week-scoped lookups of targets (the primary key leads with goal_id).
CREATE INDEX week_targets_week ON week_targets (week_start);
