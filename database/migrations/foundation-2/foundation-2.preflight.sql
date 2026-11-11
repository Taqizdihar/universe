-- READ ONLY. Run in the selected Kroombox development CMS database before any .up.sql file.
SELECT DATABASE() AS selected_database, VERSION() AS mysql_version;
SELECT required.table_name,
       IF(t.table_name IS NOT NULL AND t.engine = 'InnoDB' AND t.table_collation = 'utf8mb4_unicode_ci', 'PASS', 'FAIL') AS table_engine_and_collation_check,
       t.table_collation
FROM (SELECT 'users' AS table_name UNION ALL SELECT 'tenants' UNION ALL SELECT 'tenant_users'
      UNION ALL SELECT 'api_keys' UNION ALL SELECT 'account_auth_state' UNION ALL SELECT 'password_reset_tokens') AS required
LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = required.table_name;
SELECT required.table_name, required.column_name, IF(c.COLUMN_NAME IS NOT NULL AND c.DATA_TYPE = required.data_type, 'PASS', 'FAIL') AS column_check,
       c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT
FROM (SELECT 'users' AS table_name, 'id' AS column_name, 'int' AS data_type UNION ALL
      SELECT 'users', 'email', 'varchar' UNION ALL SELECT 'tenants', 'id', 'int' UNION ALL
      SELECT 'tenants', 'subdomain', 'varchar' UNION ALL SELECT 'tenant_users', 'tenant_id', 'int' UNION ALL
      SELECT 'tenant_users', 'user_id', 'int' UNION ALL SELECT 'api_keys', 'api_key', 'varchar') AS required
LEFT JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = required.table_name AND c.COLUMN_NAME = required.column_name;
SELECT required.table_name, required.column_name, IF(COUNT(s.INDEX_NAME) > 0, 'PASS', 'FAIL') AS single_column_unique_check
FROM (SELECT 'users' AS table_name, 'email' AS column_name UNION ALL SELECT 'tenants', 'subdomain' UNION ALL SELECT 'api_keys', 'api_key') AS required
LEFT JOIN (
  SELECT TABLE_NAME, INDEX_NAME, MAX(COLUMN_NAME) AS COLUMN_NAME
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0
  GROUP BY TABLE_NAME, INDEX_NAME
  HAVING COUNT(*) = 1
) s ON s.TABLE_NAME = required.table_name AND s.COLUMN_NAME = required.column_name
GROUP BY required.table_name, required.column_name;
SELECT t.TABLE_NAME, 'PREEXISTING_REVIEW_REQUIRED' AS action_required, t.ENGINE, t.TABLE_COLLATION
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME IN ('migration_batches', 'workspace_compatibility', 'migration_identity_map', 'migration_validation_results', 'migration_asset_map');
