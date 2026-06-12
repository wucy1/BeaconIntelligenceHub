-- Freeze zone boundaries at save time (zones may change later)

ALTER TABLE ops_saved_reports ADD COLUMN IF NOT EXISTS zone_snapshots JSONB;

COMMENT ON COLUMN ops_saved_reports.zone_snapshots IS
  'Array of {zone_id, name, geom} GeoJSON polygons captured when the report query was saved';
