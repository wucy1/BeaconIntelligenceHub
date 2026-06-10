CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE crises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name JSONB NOT NULL,
  bounds GEOMETRY(Polygon, 4326),
  archive_status TEXT NOT NULL DEFAULT 'draft' CHECK (archive_status IN ('draft', 'active', 'archived')),
  archive_window_start TIMESTAMPTZ,
  archive_window_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crisis_id UUID NOT NULL REFERENCES crises(id) ON DELETE CASCADE,
  external_ref TEXT,
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_buildings_geom ON buildings USING GIST (geom);
CREATE INDEX idx_buildings_crisis ON buildings (crisis_id);

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_generated_uuid UUID NOT NULL,
  crisis_id UUID NOT NULL REFERENCES crises(id) ON DELETE CASCADE,
  building_id UUID REFERENCES buildings(id),
  geom GEOMETRY(Point, 4326),
  textual_location TEXT,
  damage_level TEXT NOT NULL CHECK (damage_level IN ('minimal','partial','complete')),
  infrastructure_types TEXT[] NOT NULL,
  infrastructure_name TEXT NOT NULL,
  crisis_types TEXT[] NOT NULL,
  debris_clearing_required BOOLEAN NOT NULL,
  description TEXT NOT NULL,
  description_language TEXT NOT NULL,
  appendix_answers JSONB NOT NULL DEFAULT '{}',
  captured_at_client TIMESTAMPTZ NOT NULL,
  received_at_server TIMESTAMPTZ NOT NULL DEFAULT now(),
  reporter_hash TEXT,
  duplicate_of UUID REFERENCES reports(id),
  admin_reviewed BOOLEAN NOT NULL DEFAULT false,
  admin_flagged BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (crisis_id, client_generated_uuid)
);
CREATE INDEX idx_reports_crisis_time ON reports (crisis_id, received_at_server DESC);
CREATE INDEX idx_reports_building_time ON reports (building_id, received_at_server DESC);

CREATE TABLE report_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  thumb_object_key TEXT,
  mime_type TEXT NOT NULL,
  width INT,
  height INT,
  checksum_sha256 TEXT NOT NULL
);

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

-- Seed: default open-reporting crisis (no demo buildings; reference areas = ops zones)
INSERT INTO crises (id, slug, name, bounds) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'unspecified',
  '{"en": "Unspecified event (open reporting)", "zh": "未指定事件（开放回报）", "zh-Hant": "未指定事件（開放回報）"}'::jsonb,
  NULL
);

-- Phase 3a: operational zones and login users
DO $$ BEGIN
  CREATE TYPE ops_role AS ENUM ('coordinator', 'crisis_lead', 'system_admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crisis_id UUID REFERENCES crises(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  parent_zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  geom GEOMETRY(Polygon, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_zones_geom ON zones USING GIST (geom);

CREATE TABLE IF NOT EXISTS ops_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role ops_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_zone_assignments (
  user_id UUID NOT NULL REFERENCES ops_users(id) ON DELETE CASCADE,
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  assignment_role TEXT NOT NULL DEFAULT 'coordinator' CHECK (assignment_role IN ('lead', 'coordinator')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, zone_id)
);

CREATE TABLE IF NOT EXISTS report_crisis_links (
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  crisis_id UUID NOT NULL REFERENCES crises(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by UUID REFERENCES ops_users(id) ON DELETE SET NULL,
  link_source TEXT NOT NULL DEFAULT 'batch_archive',
  PRIMARY KEY (report_id, crisis_id)
);

CREATE TABLE IF NOT EXISTS crisis_lead_assignments (
  user_id UUID NOT NULL REFERENCES ops_users(id) ON DELETE CASCADE,
  crisis_id UUID NOT NULL REFERENCES crises(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, crisis_id)
);

CREATE TABLE IF NOT EXISTS ops_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES ops_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
