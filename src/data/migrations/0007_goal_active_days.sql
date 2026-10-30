-- Goals: the weekdays a weekly target is spread over for pacing (bit d = weekday d, 0 = Sunday).

ALTER TABLE goals ADD COLUMN active_days INTEGER NOT NULL DEFAULT 127 CHECK (active_days BETWEEN 1 AND 127);
