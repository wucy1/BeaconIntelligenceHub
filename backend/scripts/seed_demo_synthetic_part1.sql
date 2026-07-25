-- seed_demo_synthetic_part1.sql
-- Wipe + demo crises / zones / permissions / buildings (slug-based).

DELETE FROM report_crisis_links;
DELETE FROM report_images;
DELETE FROM reports;
DELETE FROM ops_saved_reports;
DELETE FROM ops_audit_log;
DELETE FROM user_zone_assignments;
DELETE FROM crisis_lead_assignments;
DELETE FROM zones;
DELETE FROM buildings;
DELETE FROM crises WHERE slug <> 'unspecified';

UPDATE crises
SET archive_status = 'active', archive_window_start = NULL, archive_window_end = NULL
WHERE slug = 'unspecified';

INSERT INTO crises (id, slug, name, bounds, archive_status)
SELECT 'a0000000-0000-0000-0000-000000000001'::uuid,
       'unspecified',
       '{"en":"Unspecified event (open reporting)","zh":"未指定事件（开放回报）","zh-Hant":"未指定事件（開放回報）"}'::jsonb,
       NULL,
       'active'
WHERE NOT EXISTS (SELECT 1 FROM crises WHERE slug = 'unspecified');

INSERT INTO crises (slug, name, archive_status, archive_window_start, archive_window_end)
VALUES
(
  'demo-nyc-flood-2026',
  '{"en":"Demo: NYC coastal flood 2026","zh":"演示：纽约海岸洪水 2026","zh-Hant":"示範：紐約海岸洪水 2026"}'::jsonb,
  'active',
  now() - interval '45 days',
  now() + interval '15 days'
),
(
  'demo-manila-quake-2026',
  '{"en":"Demo: Manila earthquake 2026","zh":"演示：马尼拉地震 2026","zh-Hant":"示範：馬尼拉地震 2026"}'::jsonb,
  'active',
  now() - interval '45 days',
  now() + interval '15 days'
);

UPDATE crises
SET bounds = ST_SetSRID(ST_MakeEnvelope(-74.02, 40.70, -73.97, 40.74), 4326)
WHERE slug = 'demo-nyc-flood-2026';

UPDATE crises
SET bounds = ST_SetSRID(ST_MakeEnvelope(120.97, 14.55, 121.01, 14.59), 4326)
WHERE slug = 'demo-manila-quake-2026';

INSERT INTO zones (crisis_id, name, description, geom)
SELECT c.id, 'Lower Manhattan zone', 'Synthetic ops zone for demo.',
       ST_SetSRID(ST_MakeEnvelope(-74.02, 40.70, -73.97, 40.74), 4326)
FROM crises c WHERE c.slug = 'demo-nyc-flood-2026';

INSERT INTO zones (crisis_id, name, description, geom)
SELECT c.id, 'Ermita-Malate sample zone', 'Synthetic Manila demo zone.',
       ST_SetSRID(ST_MakeEnvelope(120.97, 14.55, 121.01, 14.59), 4326)
FROM crises c WHERE c.slug = 'demo-manila-quake-2026';

INSERT INTO crisis_lead_assignments (user_id, crisis_id)
SELECT u.id, c.id
FROM ops_users u
CROSS JOIN crises c
WHERE u.is_active
  AND u.role::text IN ('system_admin', 'crisis_lead')
  AND c.slug IN ('demo-nyc-flood-2026', 'demo-manila-quake-2026');

INSERT INTO user_zone_assignments (user_id, zone_id, assignment_role)
SELECT u.id, z.id, 'coordinator'
FROM ops_users u
CROSS JOIN zones z
JOIN crises c ON c.id = z.crisis_id
WHERE u.is_active
  AND u.role::text = 'coordinator'
  AND c.slug IN ('demo-nyc-flood-2026', 'demo-manila-quake-2026');

INSERT INTO user_zone_assignments (user_id, zone_id, assignment_role)
SELECT u.id, z.id, 'lead'
FROM ops_users u
CROSS JOIN zones z
JOIN crises c ON c.id = z.crisis_id
WHERE u.is_active
  AND u.role::text = 'system_admin'
  AND c.slug IN ('demo-nyc-flood-2026', 'demo-manila-quake-2026')
  AND NOT EXISTS (SELECT 1 FROM user_zone_assignments x WHERE x.zone_id = z.id);

INSERT INTO buildings (crisis_id, external_ref, geom, name)
SELECT c.id, v.ref, ST_Multi(ST_SetSRID(ST_MakeEnvelope(v.lon - 0.00035, v.lat - 0.00035, v.lon + 0.00035, v.lat + 0.00035), 4326)), v.name
FROM crises c
JOIN (VALUES
  ('demo-nyc-1', -74.0165, 40.7033, 'Battery Park pavilion'),
  ('demo-nyc-2', -74.0105, 40.7078, 'Financial District block'),
  ('demo-nyc-3', -74.0038, 40.7062, 'South Street warehouse'),
  ('demo-nyc-4', -73.9985, 40.7089, 'Brooklyn Bridge approach')
) AS v(ref, lon, lat, name) ON true
WHERE c.slug = 'demo-nyc-flood-2026';

INSERT INTO buildings (crisis_id, external_ref, geom, name)
SELECT c.id, v.ref, ST_Multi(ST_SetSRID(ST_MakeEnvelope(v.lon - 0.00035, v.lat - 0.00035, v.lon + 0.00035, v.lat + 0.00035), 4326)), v.name
FROM crises c
JOIN (VALUES
  ('demo-mnl-1', 120.9843, 14.5763, 'Rizal Park pavilion'),
  ('demo-mnl-2', 120.9888, 14.5698, 'Malate mid-rise'),
  ('demo-mnl-3', 120.9923, 14.5823, 'Ermita clinic annex'),
  ('demo-mnl-4', 120.9808, 14.5651, 'Roxas Blvd arcade')
) AS v(ref, lon, lat, name) ON true
WHERE c.slug = 'demo-manila-quake-2026';

SELECT slug, archive_status FROM crises ORDER BY slug;
SELECT count(*) AS buildings FROM buildings WHERE external_ref LIKE 'demo-%';
SELECT count(*) AS crisis_leads FROM crisis_lead_assignments;
SELECT count(*) AS zone_assignments FROM user_zone_assignments;
