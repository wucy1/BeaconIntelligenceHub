-- Ops user profile fields (settings / team display)

ALTER TABLE ops_users ADD COLUMN IF NOT EXISTS locale TEXT;
ALTER TABLE ops_users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE ops_users ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE ops_users ADD COLUMN IF NOT EXISTS org_unit TEXT;

COMMENT ON COLUMN ops_users.locale IS 'Ops UI locale override; null = follow contributor map locale';
