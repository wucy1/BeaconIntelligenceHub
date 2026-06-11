-- Allow contributor auto-classification links (public map submit).

ALTER TABLE report_crisis_links DROP CONSTRAINT IF EXISTS report_crisis_links_link_source_check;

ALTER TABLE report_crisis_links ADD CONSTRAINT report_crisis_links_link_source_check
  CHECK (link_source IN ('batch_archive', 'manual', 'primary', 'auto_classify'));
