-- Crisis-scoped zones; lead at crisis level; coordinator at zone level

ALTER TABLE zones ADD COLUMN IF NOT EXISTS crisis_id UUID REFERENCES crises(id) ON DELETE CASCADE;

UPDATE zones
SET crisis_id = 'a0000000-0000-0000-0000-000000000001'
WHERE crisis_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_zones_crisis ON zones (crisis_id);

CREATE TABLE IF NOT EXISTS crisis_lead_assignments (
  user_id UUID NOT NULL REFERENCES ops_users(id) ON DELETE CASCADE,
  crisis_id UUID NOT NULL REFERENCES crises(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, crisis_id)
);
CREATE INDEX IF NOT EXISTS idx_crisis_lead_assignments_crisis ON crisis_lead_assignments (crisis_id);

COMMENT ON TABLE crisis_lead_assignments IS 'Crisis-level lead; may draw zones and assign coordinators within the crisis';
COMMENT ON COLUMN zones.crisis_id IS 'Zone belongs to one crisis; drawn by system_admin or crisis lead';
