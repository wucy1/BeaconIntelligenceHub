-- Organization-wide defaults (single-tenant row)

CREATE TABLE IF NOT EXISTS org_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  default_public_report_months INT NOT NULL DEFAULT 2 CHECK (default_public_report_months BETWEEN 1 AND 24),
  default_ops_view_months INT NOT NULL DEFAULT 2 CHECK (default_ops_view_months BETWEEN 1 AND 24),
  show_demo_cold_start_hint BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO org_settings (id, default_public_report_months, default_ops_view_months)
SELECT gen_random_uuid(), 2, 2
WHERE NOT EXISTS (SELECT 1 FROM org_settings LIMIT 1);

COMMENT ON TABLE org_settings IS 'Tenant defaults: public map report window, ops browse window, demo UX flags';
COMMENT ON COLUMN crises.archive_window_start IS 'event_start: official crisis event period (archive/reporting boundary)';
COMMENT ON COLUMN crises.archive_window_end IS 'event_end: official crisis event period (archive/reporting boundary)';
