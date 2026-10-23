-- Calendar subscriptions: .ics URLs (e.g. Google/Outlook secret iCal links) shown as a
-- read-only overlay. Only the subscription is stored; fetched events stay in memory.

CREATE TABLE calendar_subscriptions (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  url        TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 2048 AND url LIKE 'https://%'),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
