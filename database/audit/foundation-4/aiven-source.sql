-- READ ONLY. Explicit schema defaultdb; no reliance on DATABASE() or phpMyAdmin breadcrumb.

SELECT 'defaultdb' AS audited_schema, VERSION() AS mysql_version;

-- Exact table row counts, no tenant rows returned.

SELECT 'activity_logs' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`activity_logs`
UNION ALL
SELECT 'api_keys' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`api_keys`
UNION ALL
SELECT 'comments' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`comments`
UNION ALL
SELECT 'contact_inquiries' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`contact_inquiries`
UNION ALL
SELECT 'global_faqs' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`global_faqs`
UNION ALL
SELECT 'layouts' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`layouts`
UNION ALL
SELECT 'media' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`media`
UNION ALL
SELECT 'media_folders' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`media_folders`
UNION ALL
SELECT 'notifications' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`notifications`
UNION ALL
SELECT 'pages' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`pages`
UNION ALL
SELECT 'plugins' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`plugins`
UNION ALL
SELECT 'post_categories' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`post_categories`
UNION ALL
SELECT 'posts' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`posts`
UNION ALL
SELECT 'settings' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`settings`
UNION ALL
SELECT 'tenant_users' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`tenant_users`
UNION ALL
SELECT 'tenants' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`tenants`
UNION ALL
SELECT 'update_history' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`update_history`
UNION ALL
SELECT 'update_images' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`update_images`
UNION ALL
SELECT 'users' AS table_name, COUNT(*) AS exact_rows FROM `defaultdb`.`users`;

-- Aggregate orphan and cross-tenant counts only.

SELECT 'membership_missing_user' AS metric, COUNT(*) AS issue_count FROM `defaultdb`.`tenant_users` tu LEFT JOIN `defaultdb`.`users` u ON u.id=tu.user_id WHERE u.id IS NULL
UNION ALL
SELECT 'membership_missing_tenant' AS metric, COUNT(*) AS issue_count FROM `defaultdb`.`tenant_users` tu LEFT JOIN `defaultdb`.`tenants` t ON t.id=tu.tenant_id WHERE t.id IS NULL
UNION ALL
SELECT 'api_key_missing_tenant' AS metric, COUNT(*) AS issue_count FROM `defaultdb`.`api_keys` a LEFT JOIN `defaultdb`.`tenants` t ON t.id=a.tenant_id WHERE t.id IS NULL
UNION ALL
SELECT 'page_missing_tenant' AS metric, COUNT(*) AS issue_count FROM `defaultdb`.`pages` p LEFT JOIN `defaultdb`.`tenants` t ON t.id=p.tenant_id WHERE t.id IS NULL
UNION ALL
SELECT 'post_missing_tenant' AS metric, COUNT(*) AS issue_count FROM `defaultdb`.`posts` p LEFT JOIN `defaultdb`.`tenants` t ON t.id=p.tenant_id WHERE t.id IS NULL
UNION ALL
SELECT 'post_missing_category' AS metric, COUNT(*) AS issue_count FROM `defaultdb`.`posts` p LEFT JOIN `defaultdb`.`post_categories` c ON c.id=p.category_id WHERE p.category_id IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'post_cross_tenant_category' AS metric, COUNT(*) AS issue_count FROM `defaultdb`.`posts` p JOIN `defaultdb`.`post_categories` c ON c.id=p.category_id WHERE p.tenant_id <> c.tenant_id
UNION ALL
SELECT 'post_missing_media' AS metric, COUNT(*) AS issue_count FROM `defaultdb`.`posts` p LEFT JOIN `defaultdb`.`media` m ON m.id=p.featured_image_id WHERE p.featured_image_id IS NOT NULL AND m.id IS NULL
UNION ALL
SELECT 'post_cross_tenant_media' AS metric, COUNT(*) AS issue_count FROM `defaultdb`.`posts` p JOIN `defaultdb`.`media` m ON m.id=p.featured_image_id WHERE p.tenant_id <> m.tenant_id
UNION ALL
SELECT 'comment_missing_post' AS metric, COUNT(*) AS issue_count FROM `defaultdb`.`comments` c LEFT JOIN `defaultdb`.`posts` p ON p.id=c.post_id WHERE p.id IS NULL
UNION ALL
SELECT 'comment_cross_tenant_post' AS metric, COUNT(*) AS issue_count FROM `defaultdb`.`comments` c JOIN `defaultdb`.`posts` p ON p.id=c.post_id WHERE c.tenant_id <> p.tenant_id;

-- Collation-sensitive source-only duplicates; zero does not prove source-to-target uniqueness.

SELECT 'normalized_email' AS metric, COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM `defaultdb`.`users` GROUP BY LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci HAVING COUNT(*) > 1) d
UNION ALL
SELECT 'normalized_subdomain' AS metric, COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM `defaultdb`.`tenants` GROUP BY LOWER(TRIM(subdomain)) COLLATE utf8mb4_unicode_ci HAVING COUNT(*) > 1) d
UNION ALL
SELECT 'api_key' AS metric, COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM `defaultdb`.`api_keys` GROUP BY api_key HAVING COUNT(*) > 1) d
UNION ALL
SELECT 'page_slug' AS metric, COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM `defaultdb`.`pages` GROUP BY tenant_id, LOWER(TRIM(slug)) COLLATE utf8mb4_unicode_ci HAVING COUNT(*) > 1) d
UNION ALL
SELECT 'post_slug' AS metric, COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM `defaultdb`.`posts` GROUP BY tenant_id, LOWER(TRIM(slug)) COLLATE utf8mb4_unicode_ci HAVING COUNT(*) > 1) d;

-- FK actions, explicitly filtered to the audited schema.

SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE AS on_delete, r.UPDATE_RULE AS on_update
FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
WHERE k.TABLE_SCHEMA='defaultdb' AND k.CONSTRAINT_SCHEMA='defaultdb' AND r.CONSTRAINT_SCHEMA='defaultdb' AND k.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION;
