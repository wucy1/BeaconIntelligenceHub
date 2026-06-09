-- Per-zone lead vs coordinator; account role is system_admin or coordinator (ops member)

ALTER TABLE user_zone_assignments
  ADD COLUMN IF NOT EXISTS assignment_role TEXT NOT NULL DEFAULT 'coordinator';

ALTER TABLE user_zone_assignments DROP CONSTRAINT IF EXISTS user_zone_assignments_assignment_role_check;
ALTER TABLE user_zone_assignments ADD CONSTRAINT user_zone_assignments_assignment_role_check
  CHECK (assignment_role IN ('lead', 'coordinator'));

COMMENT ON COLUMN user_zone_assignments.assignment_role IS
  'lead: manage zone boundary and archive for this AOI; coordinator: read/review reports in zone';
