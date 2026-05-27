-- 示範用回報點（可選；若 init.sql 已含可略過）
INSERT INTO reports (
  id, client_generated_uuid, crisis_id, building_id,
  damage_level, infrastructure_types, infrastructure_name,
  crisis_types, debris_clearing_required, description, description_language,
  appendix_answers, captured_at_client, received_at_server
) VALUES
(
  'c0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'partial',
  ARRAY['residential'],
  'Demo Building A',
  ARRAY['earthquake'],
  false,
  'Demo report — partial damage on Building A',
  'en',
  '{"electricity_condition":"moderate","health_services":"partial","pressing_needs":["food_water"]}'::jsonb,
  now() - interval '2 hours',
  now() - interval '2 hours'
),
(
  'c0000000-0000-0000-0000-000000000002',
  'd0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000002',
  'complete',
  ARRAY['commercial'],
  'Demo Building B',
  ARRAY['earthquake'],
  true,
  'Demo report — severe damage on Building B',
  'en',
  '{"electricity_condition":"severe","health_services":"disrupted","pressing_needs":["shelter","health"]}'::jsonb,
  now() - interval '1 hour',
  now() - interval '1 hour'
)
ON CONFLICT (id) DO NOTHING;
