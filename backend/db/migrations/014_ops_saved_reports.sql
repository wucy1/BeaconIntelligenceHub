-- Named saved report queries (browse snapshots) for ops dashboard review

CREATE TABLE IF NOT EXISTS ops_saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES ops_users(id) ON DELETE SET NULL,
  report_view TEXT NOT NULL DEFAULT 'crisis',
  crisis_id UUID REFERENCES crises(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  browse_from TIMESTAMPTZ,
  browse_to TIMESTAMPTZ,
  review_filter TEXT NOT NULL DEFAULT 'all',
  snapshot_total INTEGER,
  snapshot_linked INTEGER,
  snapshot_candidate INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_saved_reports_created_by ON ops_saved_reports(created_by);
CREATE INDEX IF NOT EXISTS idx_ops_saved_reports_crisis ON ops_saved_reports(crisis_id);

COMMENT ON TABLE ops_saved_reports IS 'Named browse-query snapshots; dashboard reloads live data with saved filters';
