-- READ ONLY. The human administrator must inspect PASS before any later schema script.
-- USE changes only this SQL session's database context; it modifies no data.
USE `uniin_universe_reh`;
SELECT 'uniin_universe_reh' AS approved_target, DATABASE() AS selected_context,
       (SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='uniin_universe_reh') AS schema_exists,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='uniin_universe_reh') AS existing_tables,
       'BLOCKED_UNVERIFIED_SOURCE_DEFINITIONS' AS schema_import_gate,
       CASE WHEN DATABASE()='uniin_universe_reh'
         AND (SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='uniin_universe_reh')=1
         AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='uniin_universe_reh')=0
         THEN 'PASS_EMPTY_REHEARSAL_SCHEMA' ELSE 'STOP_REVIEW_REQUIRED' END AS preflight_status;
