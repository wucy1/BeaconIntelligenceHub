-- Phase 3a: operational zones, login users, zone-scoped coordinator access

DO $$ BEGIN
  CREATE TYPE ops_role AS ENUM ('coordinator', 'crisis_lead', 'system_admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  parent_zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  geom GEOMETRY(Polygon, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_zones_geom ON zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_zones_parent ON zones (parent_zone_id);

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
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, zone_id)
);
CREATE INDEX IF NOT EXISTS idx_user_zone_assignments_zone ON user_zone_assignments (zone_id);

-- Crisis archive metadata (classification is post-hoc; does not gate reporting)
ALTER TABLE crises ADD COLUMN IF NOT EXISTS archive_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE crises DROP CONSTRAINT IF EXISTS crises_archive_status_check;
ALTER TABLE crises ADD CONSTRAINT crises_archive_status_check
  CHECK (archive_status IN ('draft', 'active', 'archived'));
ALTER TABLE crises ADD COLUMN IF NOT EXISTS archive_window_start TIMESTAMPTZ;
ALTER TABLE crises ADD COLUMN IF NOT EXISTS archive_window_end TIMESTAMPTZ;

COMMENT ON TABLE zones IS 'Operational AOI drawn by admins; used for coordinator visibility and post-hoc classification';
COMMENT ON TABLE ops_users IS 'Operations login (coordinator, crisis_lead, system_admin)';
COMMENT ON COLUMN crises.archive_status IS 'Archival lifecycle only; does not block contributor reporting';
