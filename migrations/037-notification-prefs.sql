-- Per-user email notification preferences.
-- JSON object of { [notificationKey]: boolean }. A missing key means the
-- notification is enabled (opt-out model), so '{}' = all notifications on.
-- Keys are defined in src/services/notification-prefs.ts.
ALTER TABLE users ADD COLUMN notification_prefs TEXT NOT NULL DEFAULT '{}';
