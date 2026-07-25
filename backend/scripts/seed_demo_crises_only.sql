-- Tiny check + create ONLY the two demo crises (run this alone if part1 fails).
-- Expected final SELECT: 2 rows.

DELETE FROM crises WHERE slug IN ('demo-nyc-flood-2026', 'demo-manila-quake-2026');

INSERT INTO crises (slug, name, archive_status, archive_window_start, archive_window_end)
VALUES
(
  'demo-nyc-flood-2026',
  '{"en":"Demo: NYC coastal flood 2026","zh-Hant":"示範：紐約海岸洪水 2026"}'::jsonb,
  'active',
  now() - interval '45 days',
  now() + interval '15 days'
),
(
  'demo-manila-quake-2026',
  '{"en":"Demo: Manila earthquake 2026","zh-Hant":"示範：馬尼拉地震 2026"}'::jsonb,
  'active',
  now() - interval '45 days',
  now() + interval '15 days'
);

SELECT slug, id FROM crises WHERE slug LIKE 'demo-%' ORDER BY slug;
