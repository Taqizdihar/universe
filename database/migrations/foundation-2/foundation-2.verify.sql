-- READ ONLY. Run after all five .up.sql files in the selected Kroombox CMS database.
SELECT expected.table_name, IF(t.TABLE_NAME IS NOT NULL AND t.ENGINE = 'InnoDB' AND t.TABLE_COLLATION = 'utf8mb4_unicode_ci', 'PASS', 'FAIL') AS table_check,
       t.ENGINE, t.TABLE_COLLATION
FROM (SELECT 'migration_batches' AS table_name UNION ALL SELECT 'workspace_compatibility' UNION ALL
      SELECT 'migration_identity_map' UNION ALL SELECT 'migration_validation_results' UNION ALL SELECT 'migration_asset_map') AS expected
LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = expected.table_name;
SELECT expected.table_name, expected.column_name, IF(c.COLUMN_NAME IS NOT NULL AND c.DATA_TYPE = expected.data_type, 'PASS', 'FAIL') AS column_check,
       c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT
FROM (      SELECT 'migration_batches' AS table_name, 'batch_id' AS column_name, 'varchar' AS data_type
      UNION ALL SELECT 'migration_batches', 'source_system', 'varchar'
      UNION ALL SELECT 'migration_batches', 'target_environment', 'varchar'
      UNION ALL SELECT 'migration_batches', 'source_snapshot_fingerprint', 'char'
      UNION ALL SELECT 'migration_batches', 'migration_type', 'varchar'
      UNION ALL SELECT 'migration_batches', 'status', 'varchar'
      UNION ALL SELECT 'migration_batches', 'validation_summary', 'text'
      UNION ALL SELECT 'migration_batches', 'sanitized_notes', 'text'
      UNION ALL SELECT 'migration_batches', 'started_at', 'datetime'
      UNION ALL SELECT 'migration_batches', 'completed_at', 'datetime'
      UNION ALL SELECT 'migration_batches', 'created_at', 'datetime'
      UNION ALL SELECT 'migration_batches', 'updated_at', 'datetime'
      UNION ALL SELECT 'workspace_compatibility', 'id', 'bigint'
      UNION ALL SELECT 'workspace_compatibility', 'tenant_id', 'int'
      UNION ALL SELECT 'workspace_compatibility', 'origin_system', 'varchar'
      UNION ALL SELECT 'workspace_compatibility', 'content_mode', 'varchar'
      UNION ALL SELECT 'workspace_compatibility', 'api_contract_version', 'varchar'
      UNION ALL SELECT 'workspace_compatibility', 'migration_batch_id', 'varchar'
      UNION ALL SELECT 'workspace_compatibility', 'verified_at', 'datetime'
      UNION ALL SELECT 'workspace_compatibility', 'created_at', 'datetime'
      UNION ALL SELECT 'workspace_compatibility', 'updated_at', 'datetime'
      UNION ALL SELECT 'migration_identity_map', 'id', 'bigint'
      UNION ALL SELECT 'migration_identity_map', 'batch_id', 'varchar'
      UNION ALL SELECT 'migration_identity_map', 'source_system', 'varchar'
      UNION ALL SELECT 'migration_identity_map', 'entity_type', 'varchar'
      UNION ALL SELECT 'migration_identity_map', 'source_record_id', 'varchar'
      UNION ALL SELECT 'migration_identity_map', 'target_record_id', 'varchar'
      UNION ALL SELECT 'migration_identity_map', 'source_tenant_id', 'varchar'
      UNION ALL SELECT 'migration_identity_map', 'target_tenant_id', 'varchar'
      UNION ALL SELECT 'migration_identity_map', 'mapping_status', 'varchar'
      UNION ALL SELECT 'migration_identity_map', 'conflict_class', 'varchar'
      UNION ALL SELECT 'migration_identity_map', 'verified_at', 'datetime'
      UNION ALL SELECT 'migration_identity_map', 'created_at', 'datetime'
      UNION ALL SELECT 'migration_validation_results', 'id', 'bigint'
      UNION ALL SELECT 'migration_validation_results', 'batch_id', 'varchar'
      UNION ALL SELECT 'migration_validation_results', 'check_id', 'varchar'
      UNION ALL SELECT 'migration_validation_results', 'entity_type', 'varchar'
      UNION ALL SELECT 'migration_validation_results', 'expected_summary', 'varchar'
      UNION ALL SELECT 'migration_validation_results', 'actual_summary', 'varchar'
      UNION ALL SELECT 'migration_validation_results', 'status', 'varchar'
      UNION ALL SELECT 'migration_validation_results', 'sanitized_diagnostic', 'text'
      UNION ALL SELECT 'migration_validation_results', 'verified_at', 'datetime'
      UNION ALL SELECT 'migration_validation_results', 'created_at', 'datetime'
      UNION ALL SELECT 'migration_asset_map', 'id', 'bigint'
      UNION ALL SELECT 'migration_asset_map', 'batch_id', 'varchar'
      UNION ALL SELECT 'migration_asset_map', 'source_media_id', 'varchar'
      UNION ALL SELECT 'migration_asset_map', 'target_media_id', 'varchar'
      UNION ALL SELECT 'migration_asset_map', 'source_reference_type', 'varchar'
      UNION ALL SELECT 'migration_asset_map', 'target_reference_type', 'varchar'
      UNION ALL SELECT 'migration_asset_map', 'mapping_status', 'varchar'
      UNION ALL SELECT 'migration_asset_map', 'verification_status', 'varchar'
      UNION ALL SELECT 'migration_asset_map', 'verified_at', 'datetime'
      UNION ALL SELECT 'migration_asset_map', 'created_at', 'datetime') AS expected
LEFT JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = expected.table_name AND c.COLUMN_NAME = expected.column_name;
SELECT expected.table_name, expected.index_name, IF(s.INDEX_NAME IS NOT NULL AND s.NON_UNIQUE = 0, 'PASS', 'FAIL') AS unique_index_check
FROM (SELECT 'migration_batches' AS table_name, 'PRIMARY' AS index_name UNION ALL
      SELECT 'workspace_compatibility', 'uq_workspace_compatibility_tenant' UNION ALL
      SELECT 'migration_identity_map', 'uq_identity_map_source' UNION ALL
      SELECT 'migration_identity_map', 'uq_identity_map_target' UNION ALL
      SELECT 'migration_validation_results', 'uq_validation_batch_check' UNION ALL
      SELECT 'migration_asset_map', 'uq_asset_map_source' UNION ALL
      SELECT 'migration_asset_map', 'uq_asset_map_target') AS expected
LEFT JOIN information_schema.STATISTICS s ON s.TABLE_SCHEMA = DATABASE() AND s.TABLE_NAME = expected.table_name AND s.INDEX_NAME = expected.index_name AND s.SEQ_IN_INDEX = 1;
SELECT expected.constraint_name, IF(tc.CONSTRAINT_NAME IS NOT NULL, 'PASS', 'FAIL') AS foreign_key_check
FROM (SELECT 'fk_workspace_compatibility_tenant' AS constraint_name UNION ALL SELECT 'fk_workspace_compatibility_batch' UNION ALL
      SELECT 'fk_identity_map_batch' UNION ALL SELECT 'fk_validation_batch' UNION ALL SELECT 'fk_asset_map_batch') AS expected
LEFT JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.CONSTRAINT_NAME = expected.constraint_name AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY';
SELECT expected.constraint_name, IF(tc.CONSTRAINT_NAME IS NOT NULL, 'PASS', 'FAIL') AS check_constraint_check
FROM (SELECT 'chk_migration_batches_source' AS constraint_name
      UNION ALL SELECT 'chk_migration_batches_target'
      UNION ALL SELECT 'chk_migration_batches_fingerprint'
      UNION ALL SELECT 'chk_migration_batches_type'
      UNION ALL SELECT 'chk_migration_batches_status'
      UNION ALL SELECT 'chk_workspace_compatibility_origin'
      UNION ALL SELECT 'chk_workspace_compatibility_mode'
      UNION ALL SELECT 'chk_workspace_compatibility_contract'
      UNION ALL SELECT 'chk_workspace_compatibility_verified'
      UNION ALL SELECT 'chk_identity_map_source'
      UNION ALL SELECT 'chk_identity_map_entity'
      UNION ALL SELECT 'chk_identity_map_source_id'
      UNION ALL SELECT 'chk_identity_map_target_id'
      UNION ALL SELECT 'chk_identity_map_status'
      UNION ALL SELECT 'chk_identity_map_verified'
      UNION ALL SELECT 'chk_validation_status'
      UNION ALL SELECT 'chk_validation_verified'
      UNION ALL SELECT 'chk_asset_reference_source'
      UNION ALL SELECT 'chk_asset_reference_target'
      UNION ALL SELECT 'chk_asset_source_id'
      UNION ALL SELECT 'chk_asset_target_id'
      UNION ALL SELECT 'chk_asset_mapping_status'
      UNION ALL SELECT 'chk_asset_verification_status'
      UNION ALL SELECT 'chk_asset_verified') AS expected
LEFT JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.CONSTRAINT_NAME = expected.constraint_name AND tc.CONSTRAINT_TYPE = 'CHECK';
-- Data consistency checks are read-only. Empty result sets are expected immediately after installation.
SELECT b.batch_id, b.status AS batch_status, 'FAILED_OR_PENDING_VALIDATION' AS issue
FROM migration_batches b
WHERE b.status IN ('validated', 'approved', 'applied')
  AND (NOT EXISTS (SELECT 1 FROM migration_validation_results v WHERE v.batch_id = b.batch_id AND v.status = 'passed')
       OR EXISTS (SELECT 1 FROM migration_validation_results v WHERE v.batch_id = b.batch_id AND v.status <> 'passed'));
SELECT w.tenant_id, w.migration_batch_id, 'VERIFIED_WORKSPACE_WITH_UNVALIDATED_BATCH' AS issue
FROM workspace_compatibility w
LEFT JOIN migration_batches b ON b.batch_id = w.migration_batch_id
WHERE w.verified_at IS NOT NULL AND (b.batch_id IS NULL OR b.status NOT IN ('validated', 'approved', 'applied'));
SELECT m.id, m.batch_id, 'SOURCE_SYSTEM_MISMATCH' AS issue
FROM migration_identity_map m
JOIN migration_batches b ON b.batch_id = m.batch_id
WHERE m.source_system <> b.source_system;
SELECT 'migration_batches' AS table_name, COUNT(*) AS exact_rows FROM migration_batches
UNION ALL SELECT 'workspace_compatibility', COUNT(*) FROM workspace_compatibility
UNION ALL SELECT 'migration_identity_map', COUNT(*) FROM migration_identity_map
UNION ALL SELECT 'migration_validation_results', COUNT(*) FROM migration_validation_results
UNION ALL SELECT 'migration_asset_map', COUNT(*) FROM migration_asset_map;
