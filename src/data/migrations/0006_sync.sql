-- Sync support. Local-only tables (never exported or synced):
--   sync_meta:   key/value state (server url, token, username, last seq, capture flag)
--   sync_outbox: rows changed locally since the last push, one entry per row key.
-- Triggers record every change to the synced tables, including ON DELETE cascades,
-- week-start shifts and imports. Applying pulled changes sets capture = '0' first so
-- they don't echo back. `ver` lets a push clear only entries it actually sent.

CREATE TABLE sync_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

INSERT INTO sync_meta (key, value) VALUES ('capture', '1');

CREATE TABLE sync_outbox (
  tbl TEXT NOT NULL,
  key TEXT NOT NULL,
  ver INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tbl, key)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER sync_settings_ins AFTER INSERT ON settings
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1' AND NEW.key NOT IN ('theme', 'notifyNextBlock', 'notifyUnconfirmed', 'notifyWeeklyReview', 'closeToTray', 'autoCheckUpdates')
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('settings', NEW.key) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_settings_upd AFTER UPDATE ON settings
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1' AND NEW.key NOT IN ('theme', 'notifyNextBlock', 'notifyUnconfirmed', 'notifyWeeklyReview', 'closeToTray', 'autoCheckUpdates')
BEGIN
  INSERT INTO sync_outbox (tbl, key) VALUES ('settings', NEW.key) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
  INSERT INTO sync_outbox (tbl, key) VALUES ('settings', OLD.key) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
END;

CREATE TRIGGER sync_settings_del AFTER DELETE ON settings
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1' AND OLD.key NOT IN ('theme', 'notifyNextBlock', 'notifyUnconfirmed', 'notifyWeeklyReview', 'closeToTray', 'autoCheckUpdates')
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('settings', OLD.key) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_goals_ins AFTER INSERT ON goals
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('goals', NEW.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_goals_upd AFTER UPDATE ON goals
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN
  INSERT INTO sync_outbox (tbl, key) VALUES ('goals', NEW.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
  INSERT INTO sync_outbox (tbl, key) VALUES ('goals', OLD.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
END;

CREATE TRIGGER sync_goals_del AFTER DELETE ON goals
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('goals', OLD.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_week_targets_ins AFTER INSERT ON week_targets
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('weekTargets', NEW.goal_id || '|' || NEW.week_start) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_week_targets_upd AFTER UPDATE ON week_targets
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN
  INSERT INTO sync_outbox (tbl, key) VALUES ('weekTargets', NEW.goal_id || '|' || NEW.week_start) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
  INSERT INTO sync_outbox (tbl, key) VALUES ('weekTargets', OLD.goal_id || '|' || OLD.week_start) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
END;

CREATE TRIGGER sync_week_targets_del AFTER DELETE ON week_targets
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('weekTargets', OLD.goal_id || '|' || OLD.week_start) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_checklist_items_ins AFTER INSERT ON checklist_items
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('checklistItems', NEW.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_checklist_items_upd AFTER UPDATE ON checklist_items
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN
  INSERT INTO sync_outbox (tbl, key) VALUES ('checklistItems', NEW.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
  INSERT INTO sync_outbox (tbl, key) VALUES ('checklistItems', OLD.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
END;

CREATE TRIGGER sync_checklist_items_del AFTER DELETE ON checklist_items
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('checklistItems', OLD.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_templates_ins AFTER INSERT ON templates
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('templates', NEW.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_templates_upd AFTER UPDATE ON templates
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN
  INSERT INTO sync_outbox (tbl, key) VALUES ('templates', NEW.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
  INSERT INTO sync_outbox (tbl, key) VALUES ('templates', OLD.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
END;

CREATE TRIGGER sync_templates_del AFTER DELETE ON templates
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('templates', OLD.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_routines_ins AFTER INSERT ON routines
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('routines', NEW.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_routines_upd AFTER UPDATE ON routines
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN
  INSERT INTO sync_outbox (tbl, key) VALUES ('routines', NEW.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
  INSERT INTO sync_outbox (tbl, key) VALUES ('routines', OLD.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
END;

CREATE TRIGGER sync_routines_del AFTER DELETE ON routines
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('routines', OLD.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_blocks_ins AFTER INSERT ON blocks
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('blocks', NEW.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_blocks_upd AFTER UPDATE ON blocks
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN
  INSERT INTO sync_outbox (tbl, key) VALUES ('blocks', NEW.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
  INSERT INTO sync_outbox (tbl, key) VALUES ('blocks', OLD.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
END;

CREATE TRIGGER sync_blocks_del AFTER DELETE ON blocks
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('blocks', OLD.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_week_notes_ins AFTER INSERT ON week_notes
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('weekNotes', NEW.week_start) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_week_notes_upd AFTER UPDATE ON week_notes
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN
  INSERT INTO sync_outbox (tbl, key) VALUES ('weekNotes', NEW.week_start) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
  INSERT INTO sync_outbox (tbl, key) VALUES ('weekNotes', OLD.week_start) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
END;

CREATE TRIGGER sync_week_notes_del AFTER DELETE ON week_notes
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('weekNotes', OLD.week_start) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_calendar_subscriptions_ins AFTER INSERT ON calendar_subscriptions
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('calendarSubscriptions', NEW.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

CREATE TRIGGER sync_calendar_subscriptions_upd AFTER UPDATE ON calendar_subscriptions
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN
  INSERT INTO sync_outbox (tbl, key) VALUES ('calendarSubscriptions', NEW.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
  INSERT INTO sync_outbox (tbl, key) VALUES ('calendarSubscriptions', OLD.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;
END;

CREATE TRIGGER sync_calendar_subscriptions_del AFTER DELETE ON calendar_subscriptions
WHEN (SELECT value FROM sync_meta WHERE key = 'capture') = '1'
BEGIN INSERT INTO sync_outbox (tbl, key) VALUES ('calendarSubscriptions', OLD.id) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1; END;

