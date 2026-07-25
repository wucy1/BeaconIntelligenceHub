-- Demo wipe + synthetic seed for Beacon Intelligence Hub (Neon SQL Editor).
--
-- Prefer the split scripts if the console shows "ROLLBACK required" / truncates history:
--   1) seed_demo_synthetic_part1.sql
--   2) seed_demo_synthetic_part2.sql
--
-- 1) Old data: YES ??deletes reports/images/links, zones, buildings, saved queries,
--    audit log, and all crises except system "unspecified". Keeps ops_users + org_settings.
-- 2) Permissions: YES ??clears then recreates crisis_lead + zone assignments.
-- 3) Cities: NYC coastal flood + Manila earthquake.
--
-- If Neon shows Failed transaction: click ROLLBACK first (nothing was committed), then
-- re-run part1 ??part2.

BEGIN;

-- ---------------------------------------------------------------------------
-- Wipe (keeps ops_users, org_settings, unspecified crisis row)
-- ---------------------------------------------------------------------------
DELETE FROM report_crisis_links;
DELETE FROM report_images;
DELETE FROM reports;
DELETE FROM ops_saved_reports;
DELETE FROM ops_audit_log;
DELETE FROM user_zone_assignments;
DELETE FROM crisis_lead_assignments;
DELETE FROM zones;
DELETE FROM buildings;
DELETE FROM crises WHERE id <> 'a0000000-0000-0000-0000-000000000001';

UPDATE crises
SET archive_status = 'active',
    archive_window_start = NULL,
    archive_window_end = NULL
WHERE id = 'a0000000-0000-0000-0000-000000000001';

INSERT INTO crises (id, slug, name, bounds, archive_status)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'unspecified',
  '{"en":"Unspecified event (open reporting)","zh":"?芣?摰?隞塚?撘?曉??伐?","zh-Hant":"?芣?摰?隞塚???嚗?}'::jsonb,
  NULL,
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Demo crises: NYC flood + Manila quake
-- ---------------------------------------------------------------------------
INSERT INTO crises (id, slug, name, bounds, archive_status, archive_window_start, archive_window_end)
VALUES
(
  'c1000000-0000-4000-8000-000000000001',
  'demo-nyc-flood-2026',
  '{"en":"Demo: NYC coastal flood 2026","zh":"瞍內嚗瑤蝥行絲撗豢揪瘞?2026","zh-Hant":"蝷箇?嚗?蝝絲撗豢揪瘞?2026"}'::jsonb,
  ST_GeomFromText('POLYGON((-74.02 40.70, -73.97 40.70, -73.97 40.74, -74.02 40.74, -74.02 40.70))', 4326),
  'active',
  now() - interval '45 days',
  now() + interval '15 days'
),
(
  'c1000000-0000-4000-8000-000000000002',
  'demo-manila-quake-2026',
  '{"en":"Demo: Manila earthquake 2026","zh":"瞍內嚗帕撠潭??圈? 2026","zh-Hant":"蝷箇?嚗收撠潭??圈? 2026"}'::jsonb,
  ST_GeomFromText('POLYGON((120.97 14.55, 121.01 14.55, 121.01 14.59, 120.97 14.59, 120.97 14.55))', 4326),
  'active',
  now() - interval '45 days',
  now() + interval '15 days'
);

INSERT INTO zones (id, crisis_id, name, description, geom)
VALUES
(
  'e1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'Lower Manhattan zone',
  'Synthetic ops zone for demo archive/browse flows.',
  ST_GeomFromText('POLYGON((-74.02 40.70, -73.97 40.70, -73.97 40.74, -74.02 40.74, -74.02 40.70))', 4326)
),
(
  'e1000000-0000-4000-8000-000000000002',
  'c1000000-0000-4000-8000-000000000002',
  'Ermita?alate sample zone',
  'Synthetic zone covering central Manila demo footprints.',
  ST_GeomFromText('POLYGON((120.97 14.55, 121.01 14.55, 121.01 14.59, 120.97 14.59, 120.97 14.55))', 4326)
);

-- ---------------------------------------------------------------------------
-- Rebuild permission relationships from existing ops_users
-- ---------------------------------------------------------------------------
-- Crisis leads: every active system_admin + crisis_lead ??both demo crises
INSERT INTO crisis_lead_assignments (user_id, crisis_id)
SELECT u.id, c.id
FROM ops_users u
CROSS JOIN (
  SELECT id FROM crises WHERE slug IN ('demo-nyc-flood-2026', 'demo-manila-quake-2026')
) c
WHERE u.is_active = true
  AND u.role::text IN ('system_admin', 'crisis_lead');

-- Zone coordinators: active coordinators ??all demo zones (role = coordinator)
INSERT INTO user_zone_assignments (user_id, zone_id, assignment_role)
SELECT u.id, z.id, 'coordinator'
FROM ops_users u
CROSS JOIN zones z
WHERE u.is_active = true
  AND u.role::text = 'coordinator'
  AND z.crisis_id IN (
    'c1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000002'
  );

-- If there are no coordinator-role users yet, attach system_admins as zone
-- "lead" so Work/Browse zone filters still have someone assigned for demos.
INSERT INTO user_zone_assignments (user_id, zone_id, assignment_role)
SELECT u.id, z.id, 'lead'
FROM ops_users u
CROSS JOIN zones z
WHERE u.is_active = true
  AND u.role::text = 'system_admin'
  AND z.crisis_id IN (
    'c1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000002'
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_zone_assignments uza WHERE uza.zone_id = z.id
  );

-- Buildings (simple squares as MultiPolygon)
INSERT INTO buildings (id, crisis_id, external_ref, geom, name) VALUES
('b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'demo-nyc-1',
 ST_GeomFromText('MULTIPOLYGON(((-74.01685 40.70295, -74.01615 40.70295, -74.01615 40.70365, -74.01685 40.70365, -74.01685 40.70295)))', 4326),
 'Battery Park pavilion'),
('b1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'demo-nyc-2',
 ST_GeomFromText('MULTIPOLYGON(((-74.01085 40.70745, -74.01015 40.70745, -74.01015 40.70815, -74.01085 40.70815, -74.01085 40.70745)))', 4326),
 'Financial District block'),
('b1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'demo-nyc-3',
 ST_GeomFromText('MULTIPOLYGON(((-74.00415 40.70585, -74.00345 40.70585, -74.00345 40.70655, -74.00415 40.70655, -74.00415 40.70585)))', 4326),
 'South Street warehouse'),
('b1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'demo-nyc-4',
 ST_GeomFromText('MULTIPOLYGON(((-73.99885 40.70855, -73.99815 40.70855, -73.99815 40.70925, -73.99885 40.70925, -73.99885 40.70855)))', 4326),
 'Brooklyn Bridge approach'),
('b1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000002', 'demo-mnl-1',
 ST_GeomFromText('MULTIPOLYGON(((120.9840 14.5760, 120.9847 14.5760, 120.9847 14.5767, 120.9840 14.5767, 120.9840 14.5760)))', 4326),
 'Rizal Park pavilion'),
('b1000000-0000-4000-8000-000000000012', 'c1000000-0000-4000-8000-000000000002', 'demo-mnl-2',
 ST_GeomFromText('MULTIPOLYGON(((120.9885 14.5695, 120.9892 14.5695, 120.9892 14.5702, 120.9885 14.5702, 120.9885 14.5695)))', 4326),
 'Malate mid-rise'),
('b1000000-0000-4000-8000-000000000013', 'c1000000-0000-4000-8000-000000000002', 'demo-mnl-3',
 ST_GeomFromText('MULTIPOLYGON(((120.9920 14.5820, 120.9927 14.5820, 120.9927 14.5827, 120.9920 14.5827, 120.9920 14.5820)))', 4326),
 'Ermita clinic annex'),
('b1000000-0000-4000-8000-000000000014', 'c1000000-0000-4000-8000-000000000002', 'demo-mnl-4',
 ST_GeomFromText('MULTIPOLYGON(((120.9805 14.5648, 120.9812 14.5648, 120.9812 14.5655, 120.9805 14.5655, 120.9805 14.5648)))', 4326),
 'Roxas Blvd arcade');

-- Reports (NYC)
INSERT INTO reports (
  id, client_generated_uuid, crisis_id, building_id, geom, textual_location,
  damage_level, infrastructure_types, infrastructure_name, crisis_types,
  debris_clearing_required, description, description_language, appendix_answers,
  captured_at_client, received_at_server, admin_reviewed, admin_flagged
) VALUES
(
  'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
  'c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
  ST_GeomFromText('POINT(-74.0164 40.7034)', 4326), 'Battery Park pavilion',
  'partial', ARRAY['building'], 'Battery Park pavilion', ARRAY['flood'],
  true, 'Synthetic: floodwater entered ground floor; interior damp.', 'en', '{}'::jsonb,
  now() - interval '20 hours', now() - interval '20 hours' + interval '3 minutes', true, false
),
(
  'd1000000-0000-4000-8000-000000000002', gen_random_uuid(),
  'c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002',
  ST_GeomFromText('POINT(-74.0104 40.7077)', 4326), 'Financial District block',
  'complete', ARRAY['building','road'], 'Financial District block', ARRAY['flood'],
  true, 'Synthetic: facade failure and street debris after surge.', 'en', '{}'::jsonb,
  now() - interval '36 hours', now() - interval '36 hours' + interval '3 minutes', true, false
),
(
  'd1000000-0000-4000-8000-000000000003', gen_random_uuid(),
  'c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003',
  ST_GeomFromText('POINT(-74.0037 40.7061)', 4326), 'South Street warehouse',
  'partial', ARRAY['building'], 'South Street warehouse', ARRAY['flood'],
  false, 'Synthetic: basement utilities offline; upper floors usable.', 'en', '{}'::jsonb,
  now() - interval '12 hours', now() - interval '12 hours' + interval '3 minutes', false, false
),
(
  'd1000000-0000-4000-8000-000000000004', gen_random_uuid(),
  'c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000004',
  ST_GeomFromText('POINT(-73.9986 40.7088)', 4326), 'Brooklyn Bridge approach',
  'minimal', ARRAY['road','bridge'], 'Brooklyn Bridge approach', ARRAY['flood'],
  false, 'Synthetic: standing water on approach lane; traffic slowed.', 'en', '{}'::jsonb,
  now() - interval '8 hours', now() - interval '8 hours' + interval '3 minutes', false, false
),
(
  'd1000000-0000-4000-8000-000000000005', gen_random_uuid(),
  'a0000000-0000-0000-0000-000000000001', NULL,
  ST_GeomFromText('POINT(-74.0080 40.7110)', 4326), 'Utility cabinet near Fulton',
  'partial', ARRAY['power','telecom'], 'Utility cabinet near Fulton', ARRAY['flood'],
  true, 'Synthetic: outdoor cabinet submerged; outage reported nearby.', 'en', '{}'::jsonb,
  now() - interval '5 hours', now() - interval '5 hours' + interval '3 minutes', false, false
),
(
  'd1000000-0000-4000-8000-000000000006', gen_random_uuid(),
  'a0000000-0000-0000-0000-000000000001', NULL,
  ST_GeomFromText('POINT(-74.0140 40.7050)', 4326), 'Hydrant line ??West St',
  'minimal', ARRAY['water_supply'], 'Hydrant line ??West St', ARRAY['flood'],
  false, 'Synthetic: minor leak after pressure surge; no collapse.', 'en', '{}'::jsonb,
  now() - interval '48 hours', now() - interval '48 hours' + interval '3 minutes', true, false
);

-- Reports (Manila)
INSERT INTO reports (
  id, client_generated_uuid, crisis_id, building_id, geom, textual_location,
  damage_level, infrastructure_types, infrastructure_name, crisis_types,
  debris_clearing_required, description, description_language, appendix_answers,
  captured_at_client, received_at_server, admin_reviewed, admin_flagged
) VALUES
(
  'd1000000-0000-4000-8000-000000000011', gen_random_uuid(),
  'c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000011',
  ST_GeomFromText('POINT(120.9843 14.5763)', 4326), 'Rizal Park pavilion',
  'partial', ARRAY['building'], 'Rizal Park pavilion', ARRAY['earthquake'],
  true, 'Synthetic: shear cracks on columns; pavilion closed pending inspection.', 'en', '{}'::jsonb,
  now() - interval '30 hours', now() - interval '30 hours' + interval '3 minutes', true, false
),
(
  'd1000000-0000-4000-8000-000000000012', gen_random_uuid(),
  'c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000012',
  ST_GeomFromText('POINT(120.9888 14.5698)', 4326), 'Malate mid-rise',
  'complete', ARRAY['building'], 'Malate mid-rise', ARRAY['earthquake'],
  true, 'Synthetic: soft-story collapse risk; cordon established.', 'en', '{}'::jsonb,
  now() - interval '40 hours', now() - interval '40 hours' + interval '3 minutes', true, false
),
(
  'd1000000-0000-4000-8000-000000000013', gen_random_uuid(),
  'c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000013',
  ST_GeomFromText('POINT(120.9923 14.5823)', 4326), 'Ermita clinic annex',
  'minimal', ARRAY['building','health'], 'Ermita clinic annex', ARRAY['earthquake'],
  false, 'Synthetic: fallen ceiling tiles; outpatient services continue.', 'en', '{}'::jsonb,
  now() - interval '18 hours', now() - interval '18 hours' + interval '3 minutes', false, false
),
(
  'd1000000-0000-4000-8000-000000000014', gen_random_uuid(),
  'c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000014',
  ST_GeomFromText('POINT(120.9808 14.5651)', 4326), 'Roxas Blvd arcade',
  'partial', ARRAY['building','commerce'], 'Roxas Blvd arcade', ARRAY['earthquake'],
  true, 'Synthetic: facade tiles fallen onto pedestrian path.', 'en', '{}'::jsonb,
  now() - interval '10 hours', now() - interval '10 hours' + interval '3 minutes', false, false
),
(
  'd1000000-0000-4000-8000-000000000015', gen_random_uuid(),
  'a0000000-0000-0000-0000-000000000001', NULL,
  ST_GeomFromText('POINT(120.9950 14.5750)', 4326), 'Taft Ave lane closure',
  'minimal', ARRAY['road'], 'Taft Ave lane closure', ARRAY['earthquake'],
  false, 'Synthetic: temporary barrier for debris clearance.', 'en', '{}'::jsonb,
  now() - interval '6 hours', now() - interval '6 hours' + interval '3 minutes', false, false
),
(
  'd1000000-0000-4000-8000-000000000021', gen_random_uuid(),
  'a0000000-0000-0000-0000-000000000001', NULL,
  ST_GeomFromText('POINT(-73.9857 40.7484)', 4326), 'Open report (demo)',
  'minimal', ARRAY['building'], 'Open report (demo)', ARRAY['other'],
  false, 'Synthetic open pin: cracked sidewalk near Empire State area.', 'en', '{}'::jsonb,
  now() - interval '3 hours', now() - interval '3 hours' + interval '3 minutes', false, false
),
(
  'd1000000-0000-4000-8000-000000000022', gen_random_uuid(),
  'a0000000-0000-0000-0000-000000000001', NULL,
  ST_GeomFromText('POINT(120.9842 14.5995)', 4326), 'Open report (demo)',
  'minimal', ARRAY['building'], 'Open report (demo)', ARRAY['other'],
  false, 'Synthetic open pin: cracked masonry near Quiapo; no injuries reported.', 'en', '{}'::jsonb,
  now() - interval '2 hours', now() - interval '2 hours' + interval '3 minutes', false, false
);

INSERT INTO report_crisis_links (report_id, crisis_id, link_source) VALUES
('d1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'batch_archive'),
('d1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'batch_archive'),
('d1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'batch_archive'),
('d1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'batch_archive'),
('d1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000001', 'batch_archive'),
('d1000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000001', 'batch_archive'),
('d1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000002', 'batch_archive'),
('d1000000-0000-4000-8000-000000000012', 'c1000000-0000-4000-8000-000000000002', 'batch_archive'),
('d1000000-0000-4000-8000-000000000013', 'c1000000-0000-4000-8000-000000000002', 'batch_archive'),
('d1000000-0000-4000-8000-000000000014', 'c1000000-0000-4000-8000-000000000002', 'batch_archive'),
('d1000000-0000-4000-8000-000000000015', 'c1000000-0000-4000-8000-000000000002', 'batch_archive');

COMMIT;

-- Sanity checks
SELECT slug, archive_status FROM crises ORDER BY slug;
SELECT count(*) AS reports FROM reports;
SELECT count(*) AS buildings FROM buildings;
SELECT count(*) AS crisis_leads FROM crisis_lead_assignments;
SELECT count(*) AS zone_assignments FROM user_zone_assignments;
