-- READ ONLY. Administrator-run on Kroombox to resolve gaps in the supplied export.
-- Explicitly inspects the existing development schema; no tenant rows are selected.
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'uniin_universe' AND TABLE_NAME IN
('migration_asset_map','migration_batches','migration_identity_map','migration_validation_results','workspace_compatibility')
ORDER BY TABLE_NAME;
SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
FROM information_schema.TABLE_CONSTRAINTS tc
JOIN information_schema.CHECK_CONSTRAINTS cc
  ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
WHERE tc.CONSTRAINT_SCHEMA = 'uniin_universe' AND tc.CONSTRAINT_TYPE = 'CHECK'
  AND tc.TABLE_NAME IN ('migration_asset_map','migration_batches','migration_identity_map','migration_validation_results','workspace_compatibility')
ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME;
SHOW CREATE TABLE `uniin_universe`.`migration_asset_map`;
SHOW CREATE TABLE `uniin_universe`.`migration_batches`;
SHOW CREATE TABLE `uniin_universe`.`migration_identity_map`;
SHOW CREATE TABLE `uniin_universe`.`migration_validation_results`;
SHOW CREATE TABLE `uniin_universe`.`workspace_compatibility`;
