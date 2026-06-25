-- Additive performance indexes for hot vendor app query shapes.

CREATE INDEX IF NOT EXISTS idx_analytics_events_vendor_type_created
  ON analytics_events(vendor_id, event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_vendor_status_paid
  ON invoice_payments(vendor_id, status, paid_at);

CREATE INDEX IF NOT EXISTS idx_contacts_vendor_created
  ON contacts(vendor_id, created_at);

CREATE INDEX IF NOT EXISTS idx_contacts_vendor_source
  ON contacts(vendor_id, source);

CREATE INDEX IF NOT EXISTS idx_busyness_scores_level_value_date
  ON busyness_scores(level, level_value, date);

CREATE INDEX IF NOT EXISTS idx_file_index_contact_status
  ON file_index(vendor_id, entity_type, json_extract(cached_data, '$.status'));

CREATE INDEX IF NOT EXISTS idx_file_index_contact_created
  ON file_index(vendor_id, entity_type, json_extract(cached_data, '$.created_at'));
