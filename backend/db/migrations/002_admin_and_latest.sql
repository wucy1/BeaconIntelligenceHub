-- Run on existing Neon/Postgres after init.sql

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS admin_reviewed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_flagged BOOLEAN NOT NULL DEFAULT false;

DROP VIEW IF EXISTS latest_report_per_building;

-- UNDP versioning: bias complete > partial > minimal, then most recent capture time
CREATE OR REPLACE VIEW latest_report_per_building AS
SELECT DISTINCT ON (building_id)
  r.*
FROM reports r
WHERE r.building_id IS NOT NULL
ORDER BY
  r.building_id,
  CASE r.damage_level
    WHEN 'complete' THEN 3
    WHEN 'partial' THEN 2
    WHEN 'minimal' THEN 1
    ELSE 0
  END DESC,
  r.captured_at_client DESC,
  r.received_at_server DESC;
