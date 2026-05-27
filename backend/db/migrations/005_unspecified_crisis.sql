-- Rename demo crisis to unspecified (open reporting until admin defines bounds/window).
UPDATE crises
SET
  slug = 'unspecified',
  name = '{"en": "Unspecified event (open reporting)", "zh": "未指定事件（开放回报）", "zh-Hant": "未指定事件（開放回報）"}'::jsonb
WHERE slug = 'demo-taipei';

COMMENT ON COLUMN crises.bounds IS 'Optional admin reference AOI; NULL = unspecified phase, does not restrict report submission';
