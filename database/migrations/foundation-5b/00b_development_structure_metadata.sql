-- READ ONLY. Alternative to truncated phpMyAdmin SHOW CREATE TABLE output.
-- Run on Kroombox and export EACH result set as CSV. This selects schema metadata only.
-- The five tables use the explicit development schema; no rehearsal or tenant rows are read.
SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
       COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME, GENERATION_EXPRESSION
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='uniin_universe'
  AND TABLE_NAME IN ('migration_asset_map','migration_batches','migration_identity_map','migration_validation_results','workspace_compatibility')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
       COLLATION, SUB_PART, INDEX_TYPE, EXPRESSION
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA='uniin_universe'
  AND TABLE_NAME IN ('migration_asset_map','migration_batches','migration_identity_map','migration_validation_results','workspace_compatibility')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION, k.COLUMN_NAME,
       k.REFERENCED_TABLE_SCHEMA, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
       r.DELETE_RULE, r.UPDATE_RULE
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
  ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME
 AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
WHERE k.TABLE_SCHEMA='uniin_universe' AND k.REFERENCED_TABLE_NAME IS NOT NULL
  AND k.TABLE_NAME IN ('migration_asset_map','migration_batches','migration_identity_map','migration_validation_results','workspace_compatibility')
ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION;
