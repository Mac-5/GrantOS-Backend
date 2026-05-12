-- Migration: ZK proof system v2 hardening
-- Apply after deploying the v2 backend.
--
-- Summary of changes:
--   C1: Drop private ZK input columns (commit_count, total_stars, contribution_events_90d)
--   C3: Add wallet address limb columns (wallet_address_hi, wallet_address_lo)
--   H3: Drop orgs column (no longer fetched)

BEGIN;

-- C3: add wallet address limbs
ALTER TABLE web_proofs
  ADD COLUMN IF NOT EXISTS wallet_address_hi VARCHAR(80),
  ADD COLUMN IF NOT EXISTS wallet_address_lo VARCHAR(80);

-- C1: remove private ZK inputs
-- WARNING: back up data first if you need it for analytics.
-- These values should never have been stored — see audit finding C1.
ALTER TABLE web_proofs
  DROP COLUMN IF EXISTS commit_count,
  DROP COLUMN IF EXISTS total_stars,
  DROP COLUMN IF EXISTS contribution_events_90d;

-- H3: remove org membership (no longer fetched, was unnecessary)
-- Keep the column nullable for backward compat with existing rows that may have data.
-- ALTER TABLE web_proofs DROP COLUMN IF EXISTS orgs;
-- Uncomment above after confirming no downstream consumers read this column.

COMMIT;
