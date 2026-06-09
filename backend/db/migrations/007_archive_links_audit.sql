-- Phase 3b/3c: post-hoc crisis links, audit trail

CREATE TABLE IF NOT EXISTS report_crisis_links (
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  crisis_id UUID NOT NULL REFERENCES crises(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by UUID REFERENCES ops_users(id) ON DELETE SET NULL,
  link_source TEXT NOT NULL DEFAULT 'batch_archive'
    CHECK (link_source IN ('batch_archive', 'manual', 'primary')),
  PRIMARY KEY (report_id, crisis_id)
);
CREATE INDEX IF NOT EXISTS idx_report_crisis_links_crisis ON report_crisis_links (crisis_id);

CREATE TABLE IF NOT EXISTS ops_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES ops_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_audit_log_created ON ops_audit_log (created_at DESC);

COMMENT ON TABLE report_crisis_links IS 'Post-hoc classification: a report may link to multiple archive crises';
COMMENT ON TABLE ops_audit_log IS 'Operations audit trail (zones, crises, archive runs, reviews)';
