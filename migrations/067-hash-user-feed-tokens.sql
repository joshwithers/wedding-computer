-- Personal calendar feed tokens are now stored as sha256:<hex> and shown only
-- once on generation. Existing raw capability URLs are intentionally broken;
-- users can regenerate from Account.
UPDATE users
SET feed_token = NULL
WHERE feed_token IS NOT NULL
  AND feed_token NOT LIKE 'sha256:%';
