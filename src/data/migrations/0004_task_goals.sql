-- Task-based goals: a goal can be measured by outcomes done instead of minutes logged.

ALTER TABLE goals ADD COLUMN track_by TEXT NOT NULL DEFAULT 'time' CHECK (track_by IN ('time', 'tasks'));

ALTER TABLE week_targets ADD COLUMN target_count INTEGER CHECK (target_count IS NULL OR target_count BETWEEN 0 AND 10000);
