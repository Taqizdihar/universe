-- READ ONLY. Run after full schema verification and before any synthetic bootstrap.
USE `uniin_universe_reh`;
SELECT 'uniin_universe_reh' AS approved_target, DATABASE() AS selected_context,
       CASE WHEN DATABASE()='uniin_universe_reh' THEN 'PASS' ELSE 'FAIL' END AS context_check;
SELECT 'account_auth_state' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`account_auth_state`
UNION ALL
SELECT 'activity_logs' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`activity_logs`
UNION ALL
SELECT 'api_keys' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`api_keys`
UNION ALL
SELECT 'comments' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`comments`
UNION ALL
SELECT 'contact_inquiries' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`contact_inquiries`
UNION ALL
SELECT 'global_faqs' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`global_faqs`
UNION ALL
SELECT 'layouts' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`layouts`
UNION ALL
SELECT 'media' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`media`
UNION ALL
SELECT 'media_folders' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`media_folders`
UNION ALL
SELECT 'migration_asset_map' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`migration_asset_map`
UNION ALL
SELECT 'migration_batches' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`migration_batches`
UNION ALL
SELECT 'migration_identity_map' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`migration_identity_map`
UNION ALL
SELECT 'migration_validation_results' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`migration_validation_results`
UNION ALL
SELECT 'notifications' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`notifications`
UNION ALL
SELECT 'pages' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`pages`
UNION ALL
SELECT 'password_reset_tokens' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`password_reset_tokens`
UNION ALL
SELECT 'plugins' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`plugins`
UNION ALL
SELECT 'post_categories' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`post_categories`
UNION ALL
SELECT 'posts' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`posts`
UNION ALL
SELECT 'settings' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`settings`
UNION ALL
SELECT 'super_admin_verifications' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`super_admin_verifications`
UNION ALL
SELECT 'tenant_users' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`tenant_users`
UNION ALL
SELECT 'tenants' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`tenants`
UNION ALL
SELECT 'update_history' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`update_history`
UNION ALL
SELECT 'update_images' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`update_images`
UNION ALL
SELECT 'user_global_roles' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`user_global_roles`
UNION ALL
SELECT 'users' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`users`
UNION ALL
SELECT 'workspace_compatibility' AS table_name, COUNT(*) AS exact_rows FROM `uniin_universe_reh`.`workspace_compatibility`;
-- All 28 exact_rows values must equal 0. Any nonzero result requires review.
