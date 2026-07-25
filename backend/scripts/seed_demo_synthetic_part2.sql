-- seed_demo_synthetic_part2.sql (short; paste fresh, do not re-run from Neon History)

DELETE FROM report_crisis_links;
DELETE FROM report_images;
DELETE FROM reports;

INSERT INTO reports (
  id, client_generated_uuid, crisis_id, building_id, geom, textual_location,
  damage_level, infrastructure_types, infrastructure_name, crisis_types,
  debris_clearing_required, description, description_language, appendix_answers,
  captured_at_client, received_at_server, admin_reviewed, admin_flagged
)
SELECT gen_random_uuid(), gen_random_uuid(), c.id, b.id,
       ST_SetSRID(ST_MakePoint(-74.0164, 40.7034), 4326),
       'Battery Park pavilion', 'partial', ARRAY['building'], 'Battery Park pavilion',
       ARRAY['flood'], true, 'Synthetic NYC flood report 1', 'en', '{}'::jsonb,
       now() - interval '20 hours', now() - interval '19 hours', true, false
FROM crises c
JOIN buildings b ON b.crisis_id = c.id AND b.external_ref = 'demo-nyc-1'
WHERE c.slug = 'demo-nyc-flood-2026';

INSERT INTO reports (
  id, client_generated_uuid, crisis_id, building_id, geom, textual_location,
  damage_level, infrastructure_types, infrastructure_name, crisis_types,
  debris_clearing_required, description, description_language, appendix_answers,
  captured_at_client, received_at_server, admin_reviewed, admin_flagged
)
SELECT gen_random_uuid(), gen_random_uuid(), c.id, b.id,
       ST_SetSRID(ST_MakePoint(-74.0104, 40.7077), 4326),
       'Financial District block', 'complete', ARRAY['building','road'], 'Financial District block',
       ARRAY['flood'], true, 'Synthetic NYC flood report 2', 'en', '{}'::jsonb,
       now() - interval '36 hours', now() - interval '35 hours', true, false
FROM crises c
JOIN buildings b ON b.crisis_id = c.id AND b.external_ref = 'demo-nyc-2'
WHERE c.slug = 'demo-nyc-flood-2026';

INSERT INTO reports (
  id, client_generated_uuid, crisis_id, building_id, geom, textual_location,
  damage_level, infrastructure_types, infrastructure_name, crisis_types,
  debris_clearing_required, description, description_language, appendix_answers,
  captured_at_client, received_at_server, admin_reviewed, admin_flagged
)
SELECT gen_random_uuid(), gen_random_uuid(), c.id, b.id,
       ST_SetSRID(ST_MakePoint(-74.0037, 40.7061), 4326),
       'South Street warehouse', 'partial', ARRAY['building'], 'South Street warehouse',
       ARRAY['flood'], false, 'Synthetic NYC flood report 3', 'en', '{}'::jsonb,
       now() - interval '12 hours', now() - interval '11 hours', false, false
FROM crises c
JOIN buildings b ON b.crisis_id = c.id AND b.external_ref = 'demo-nyc-3'
WHERE c.slug = 'demo-nyc-flood-2026';

INSERT INTO reports (
  id, client_generated_uuid, crisis_id, building_id, geom, textual_location,
  damage_level, infrastructure_types, infrastructure_name, crisis_types,
  debris_clearing_required, description, description_language, appendix_answers,
  captured_at_client, received_at_server, admin_reviewed, admin_flagged
)
SELECT gen_random_uuid(), gen_random_uuid(), c.id, NULL,
       ST_SetSRID(ST_MakePoint(-74.0080, 40.7110), 4326),
       'Utility cabinet near Fulton', 'partial', ARRAY['power','telecom'], 'Utility cabinet near Fulton',
       ARRAY['flood'], true, 'Synthetic NYC open pin', 'en', '{}'::jsonb,
       now() - interval '5 hours', now() - interval '4 hours', false, false
FROM crises c WHERE c.slug = 'unspecified';

INSERT INTO reports (
  id, client_generated_uuid, crisis_id, building_id, geom, textual_location,
  damage_level, infrastructure_types, infrastructure_name, crisis_types,
  debris_clearing_required, description, description_language, appendix_answers,
  captured_at_client, received_at_server, admin_reviewed, admin_flagged
)
SELECT gen_random_uuid(), gen_random_uuid(), c.id, b.id,
       ST_SetSRID(ST_MakePoint(120.9843, 14.5763), 4326),
       'Rizal Park pavilion', 'partial', ARRAY['building'], 'Rizal Park pavilion',
       ARRAY['earthquake'], true, 'Synthetic Manila quake report 1', 'en', '{}'::jsonb,
       now() - interval '30 hours', now() - interval '29 hours', true, false
FROM crises c
JOIN buildings b ON b.crisis_id = c.id AND b.external_ref = 'demo-mnl-1'
WHERE c.slug = 'demo-manila-quake-2026';

INSERT INTO reports (
  id, client_generated_uuid, crisis_id, building_id, geom, textual_location,
  damage_level, infrastructure_types, infrastructure_name, crisis_types,
  debris_clearing_required, description, description_language, appendix_answers,
  captured_at_client, received_at_server, admin_reviewed, admin_flagged
)
SELECT gen_random_uuid(), gen_random_uuid(), c.id, b.id,
       ST_SetSRID(ST_MakePoint(120.9888, 14.5698), 4326),
       'Malate mid-rise', 'complete', ARRAY['building'], 'Malate mid-rise',
       ARRAY['earthquake'], true, 'Synthetic Manila quake report 2', 'en', '{}'::jsonb,
       now() - interval '40 hours', now() - interval '39 hours', true, false
FROM crises c
JOIN buildings b ON b.crisis_id = c.id AND b.external_ref = 'demo-mnl-2'
WHERE c.slug = 'demo-manila-quake-2026';

INSERT INTO reports (
  id, client_generated_uuid, crisis_id, building_id, geom, textual_location,
  damage_level, infrastructure_types, infrastructure_name, crisis_types,
  debris_clearing_required, description, description_language, appendix_answers,
  captured_at_client, received_at_server, admin_reviewed, admin_flagged
)
SELECT gen_random_uuid(), gen_random_uuid(), c.id, NULL,
       ST_SetSRID(ST_MakePoint(120.9842, 14.5995), 4326),
       'Open report (demo)', 'minimal', ARRAY['building'], 'Open report (demo)',
       ARRAY['other'], false, 'Synthetic Manila open pin', 'en', '{}'::jsonb,
       now() - interval '2 hours', now() - interval '1 hours', false, false
FROM crises c WHERE c.slug = 'unspecified';

INSERT INTO report_crisis_links (report_id, crisis_id, link_source)
SELECT r.id, c.id, 'batch_archive'
FROM reports r
JOIN crises c ON c.slug = 'demo-nyc-flood-2026'
WHERE r.description LIKE 'Synthetic NYC%'
ON CONFLICT DO NOTHING;

INSERT INTO report_crisis_links (report_id, crisis_id, link_source)
SELECT r.id, c.id, 'batch_archive'
FROM reports r
JOIN crises c ON c.slug = 'demo-manila-quake-2026'
WHERE r.description LIKE 'Synthetic Manila%'
ON CONFLICT DO NOTHING;

SELECT count(*) AS reports FROM reports;
SELECT count(*) AS links FROM report_crisis_links;
SELECT left(description, 40) AS preview FROM reports ORDER BY captured_at_client DESC;
