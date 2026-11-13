-- Foundation 5B: manually reviewed, structure only. Run only after 01 preflight passes.
-- All DDL is explicitly bound to the approved disposable rehearsal schema.
-- Source dump SHA-256: 0d199f3baee88f2d81b583d755fccb9801c99a2d05d60874c9cfb9b136e87c08
-- No rows, production credentials, or transaction wrappers are included.
USE `uniin_universe_reh`;

CREATE TABLE `uniin_universe_reh`.`account_auth_state` (
  `user_id` int NOT NULL,
  `version` bigint UNSIGNED NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`activity_logs` (
  `id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `actor_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_role` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'SUCCESS',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`api_keys` (
  `id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `api_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'Main Key',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`comments` (
  `id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `post_id` int DEFAULT NULL,
  `author_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `author_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content` text COLLATE utf8mb4_unicode_ci,
  `status` enum('pending','approved','spam') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`contact_inquiries` (
  `id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('unread','read') COLLATE utf8mb4_unicode_ci DEFAULT 'unread',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`global_faqs` (
  `id` int NOT NULL,
  `question` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `answer` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Umum',
  `priority` int DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`layouts` (
  `id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `page_identifier` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `blocks_order` longtext COLLATE utf8mb4_unicode_ci,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`media` (
  `id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_url` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` int DEFAULT '0',
  `uploaded_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `folder_id` int DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'ready'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`media_folders` (
  `id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `parent_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`migration_asset_map` (
  `id` bigint UNSIGNED NOT NULL,
  `batch_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_media_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_media_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `source_reference_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_reference_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mapping_status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'proposed',
  `verification_status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `verified_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_asset_reference_source CHECK (source_reference_type IN ('db_media_id', 'cdn_file_id', 'media_url', 'nested_json_reference')),
  CONSTRAINT chk_asset_reference_target CHECK (target_reference_type IS NULL OR target_reference_type IN ('db_media_id', 'cdn_file_id', 'media_url', 'nested_json_reference')),
  CONSTRAINT chk_asset_source_id CHECK (source_media_id REGEXP '^[A-Za-z0-9:_-]{1,128}$'),
  CONSTRAINT chk_asset_target_id CHECK (target_media_id IS NULL OR target_media_id REGEXP '^[A-Za-z0-9:_-]{1,128}$'),
  CONSTRAINT chk_asset_mapping_status CHECK (mapping_status IN ('proposed', 'needs_review', 'verified', 'rejected')),
  CONSTRAINT chk_asset_verification_status CHECK (verification_status IN ('pending', 'passed', 'failed')),
  CONSTRAINT chk_asset_verified CHECK (verified_at IS NULL OR (mapping_status = 'verified' AND verification_status = 'passed' AND target_media_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`migration_batches` (
  `batch_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_system` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_environment` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_snapshot_fingerprint` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `migration_type` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'planned',
  `validation_summary` text COLLATE utf8mb4_unicode_ci,
  `sanitized_notes` text COLLATE utf8mb4_unicode_ci,
  `started_at` datetime(6) DEFAULT NULL,
  `completed_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_migration_batches_source CHECK (source_system IN ('aiven_v2', 'kroombox_native', 'manual_import')),
  CONSTRAINT chk_migration_batches_target CHECK (target_environment IN ('kroombox_development', 'kroombox_staging', 'kroombox_production')),
  CONSTRAINT chk_migration_batches_fingerprint CHECK (source_snapshot_fingerprint REGEXP '^[0-9a-fA-F]{64}$'),
  CONSTRAINT chk_migration_batches_type CHECK (migration_type IN ('rehearsal', 'cutover', 'reconciliation')),
  CONSTRAINT chk_migration_batches_status CHECK (status IN ('planned', 'prepared', 'validated', 'approved', 'applied', 'failed', 'rolled_back', 'reconciled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`migration_identity_map` (
  `id` bigint UNSIGNED NOT NULL,
  `batch_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_system` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_record_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_record_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `source_tenant_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `target_tenant_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `mapping_status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'proposed',
  `conflict_class` varchar(48) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `verified_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_identity_map_source CHECK (source_system IN ('aiven_v2', 'kroombox_native', 'manual_import')),
  CONSTRAINT chk_identity_map_entity CHECK (entity_type IN ('users', 'tenants', 'tenant_users', 'user_global_roles', 'api_keys', 'pages', 'posts', 'post_categories', 'media', 'media_folders', 'settings', 'layouts', 'comments', 'contact_inquiries', 'notifications', 'activity_logs', 'plugins', 'global_faqs')),
  CONSTRAINT chk_identity_map_source_id CHECK (source_record_id REGEXP '^[A-Za-z0-9:_-]{1,128}$'),
  CONSTRAINT chk_identity_map_target_id CHECK (target_record_id IS NULL OR target_record_id REGEXP '^[A-Za-z0-9:_-]{1,128}$'),
  CONSTRAINT chk_identity_map_status CHECK (mapping_status IN ('proposed', 'needs_review', 'verified', 'rejected')),
  CONSTRAINT chk_identity_map_verified CHECK (verified_at IS NULL OR (mapping_status = 'verified' AND target_record_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`migration_validation_results` (
  `id` bigint UNSIGNED NOT NULL,
  `batch_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `check_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'batch',
  `expected_summary` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actual_summary` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `sanitized_diagnostic` text COLLATE utf8mb4_unicode_ci,
  `verified_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_validation_status CHECK (status IN ('pending', 'passed', 'failed', 'waived')),
  CONSTRAINT chk_validation_verified CHECK (verified_at IS NULL OR status IN ('passed', 'waived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`notifications` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `type` enum('invitation','system_update','alert') COLLATE utf8mb4_unicode_ci DEFAULT 'invitation',
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_read` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`pages` (
  `id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'hidden',
  `author_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_in_navbar` tinyint(1) DEFAULT '0',
  `priority` int DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`password_reset_tokens` (
  `id` bigint UNSIGNED NOT NULL,
  `user_id` int NOT NULL,
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `consumed_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`plugins` (
  `id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint(1) DEFAULT '0',
  `config` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`posts` (
  `id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category_id` int DEFAULT NULL,
  `excerpt` text COLLATE utf8mb4_unicode_ci,
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `featured_image_id` int DEFAULT NULL,
  `status` enum('draft','published') COLLATE utf8mb4_unicode_ci DEFAULT 'draft',
  `author_id` int DEFAULT NULL,
  `published_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`post_categories` (
  `id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`settings` (
  `id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `site_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `logo_url` text COLLATE utf8mb4_unicode_ci,
  `tagline` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_template` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'minimalist',
  `global_options` longtext COLLATE utf8mb4_unicode_ci,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`super_admin_verifications` (
  `id` bigint UNSIGNED NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `purpose` enum('bootstrap','recovery') COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `attempt_count` int UNSIGNED NOT NULL DEFAULT '0',
  `consumed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`tenants` (
  `id` int NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subdomain` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('active','suspended') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`tenant_users` (
  `id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `user_id` int NOT NULL,
  `role` enum('admin','co_admin','content_creative','guest','super_admin') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','active','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `invited_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `last_active_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`update_history` (
  `update_id` int NOT NULL,
  `update_title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `update_description` text COLLATE utf8mb4_unicode_ci,
  `update_version` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `update_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`update_images` (
  `id` int NOT NULL,
  `update_id` int NOT NULL,
  `image_url` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`users` (
  `id` int NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipient_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `profile_picture_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`user_global_roles` (
  `user_id` int NOT NULL,
  `role` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `uniin_universe_reh`.`workspace_compatibility` (
  `id` bigint UNSIGNED NOT NULL,
  `tenant_id` int NOT NULL,
  `origin_system` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'kroombox_native',
  `content_mode` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'legacy_compatible',
  `api_contract_version` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'legacy-api-v1',
  `migration_batch_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `verified_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_workspace_compatibility_origin CHECK (origin_system IN ('aiven_v2', 'kroombox_native', 'manual_import')),
  CONSTRAINT chk_workspace_compatibility_mode CHECK (content_mode IN ('legacy_compatible', 'hybrid', 'native_v2')),
  CONSTRAINT chk_workspace_compatibility_contract CHECK (api_contract_version IN ('legacy-api-v1', 'dynamic-api-v2')),
  CONSTRAINT chk_workspace_compatibility_verified CHECK (verified_at IS NULL OR migration_batch_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `uniin_universe_reh`.`account_auth_state`
  ADD PRIMARY KEY (`user_id`);

ALTER TABLE `uniin_universe_reh`.`activity_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_tenant` (`tenant_id`),
  ADD KEY `idx_created` (`created_at`);

ALTER TABLE `uniin_universe_reh`.`api_keys`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `api_key` (`api_key`),
  ADD KEY `tenant_id` (`tenant_id`);

ALTER TABLE `uniin_universe_reh`.`comments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `tenant_id` (`tenant_id`),
  ADD KEY `post_id` (`post_id`);

ALTER TABLE `uniin_universe_reh`.`contact_inquiries`
  ADD PRIMARY KEY (`id`),
  ADD KEY `tenant_id` (`tenant_id`);

ALTER TABLE `uniin_universe_reh`.`global_faqs`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `uniin_universe_reh`.`layouts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `tenant_id` (`tenant_id`);

ALTER TABLE `uniin_universe_reh`.`media`
  ADD PRIMARY KEY (`id`),
  ADD KEY `tenant_id` (`tenant_id`),
  ADD KEY `uploaded_by` (`uploaded_by`),
  ADD KEY `fk_media_folder` (`folder_id`);

ALTER TABLE `uniin_universe_reh`.`media_folders`
  ADD PRIMARY KEY (`id`),
  ADD KEY `tenant_id` (`tenant_id`),
  ADD KEY `parent_id` (`parent_id`);

ALTER TABLE `uniin_universe_reh`.`migration_asset_map`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_asset_map_source` (`batch_id`,`source_media_id`),
  ADD UNIQUE KEY `uq_asset_map_target` (`batch_id`,`target_media_id`);

ALTER TABLE `uniin_universe_reh`.`migration_batches`
  ADD PRIMARY KEY (`batch_id`),
  ADD KEY `idx_migration_batches_status` (`status`,`created_at`);

ALTER TABLE `uniin_universe_reh`.`migration_identity_map`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_identity_map_source` (`batch_id`,`source_system`,`entity_type`,`source_record_id`),
  ADD UNIQUE KEY `uq_identity_map_target` (`batch_id`,`entity_type`,`target_record_id`),
  ADD KEY `idx_identity_map_tenant` (`batch_id`,`source_tenant_id`,`target_tenant_id`);

ALTER TABLE `uniin_universe_reh`.`migration_validation_results`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_validation_batch_check` (`batch_id`,`check_id`,`entity_type`),
  ADD KEY `idx_validation_batch_status` (`batch_id`,`status`);

ALTER TABLE `uniin_universe_reh`.`notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `tenant_id` (`tenant_id`);

ALTER TABLE `uniin_universe_reh`.`pages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `tenant_id` (`tenant_id`),
  ADD KEY `author_id` (`author_id`);

ALTER TABLE `uniin_universe_reh`.`password_reset_tokens`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_password_reset_hash` (`token_hash`),
  ADD KEY `idx_password_reset_user_time` (`user_id`,`created_at`);

ALTER TABLE `uniin_universe_reh`.`plugins`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `uniin_universe_reh`.`posts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `tenant_id` (`tenant_id`),
  ADD KEY `featured_image_id` (`featured_image_id`),
  ADD KEY `author_id` (`author_id`),
  ADD KEY `fk_posts_post_categories` (`category_id`);

ALTER TABLE `uniin_universe_reh`.`post_categories`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_tenant_id` (`tenant_id`);

ALTER TABLE `uniin_universe_reh`.`settings`
  ADD PRIMARY KEY (`id`),
  ADD KEY `tenant_id` (`tenant_id`);

ALTER TABLE `uniin_universe_reh`.`super_admin_verifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_super_admin_verifications_email_purpose` (`email`,`purpose`,`expires_at`);

ALTER TABLE `uniin_universe_reh`.`tenants`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `subdomain` (`subdomain`);

ALTER TABLE `uniin_universe_reh`.`tenant_users`
  ADD PRIMARY KEY (`tenant_id`,`user_id`),
  ADD UNIQUE KEY `id` (`id`),
  ADD KEY `fk_user` (`user_id`);

ALTER TABLE `uniin_universe_reh`.`update_history`
  ADD PRIMARY KEY (`update_id`);

ALTER TABLE `uniin_universe_reh`.`update_images`
  ADD PRIMARY KEY (`id`),
  ADD KEY `update_id` (`update_id`);

ALTER TABLE `uniin_universe_reh`.`users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`);

ALTER TABLE `uniin_universe_reh`.`user_global_roles`
  ADD PRIMARY KEY (`user_id`,`role`);

ALTER TABLE `uniin_universe_reh`.`workspace_compatibility`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_workspace_compatibility_tenant` (`tenant_id`),
  ADD KEY `idx_workspace_compatibility_batch` (`migration_batch_id`);

ALTER TABLE `uniin_universe_reh`.`activity_logs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`api_keys`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`comments`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`contact_inquiries`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`global_faqs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`layouts`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`media`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`media_folders`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`migration_asset_map`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`migration_identity_map`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`migration_validation_results`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`notifications`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`pages`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`password_reset_tokens`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`plugins`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`posts`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`post_categories`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`settings`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`super_admin_verifications`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`tenants`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`tenant_users`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`update_history`
  MODIFY `update_id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`update_images`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`users`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`workspace_compatibility`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE `uniin_universe_reh`.`account_auth_state`
  ADD CONSTRAINT `fk_auth_state_user` FOREIGN KEY (`user_id`) REFERENCES `uniin_universe_reh`.`users` (`id`) ON DELETE CASCADE;

ALTER TABLE `uniin_universe_reh`.`api_keys`
  ADD CONSTRAINT `api_keys_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `uniin_universe_reh`.`tenants` (`id`) ON DELETE CASCADE;

ALTER TABLE `uniin_universe_reh`.`comments`
  ADD CONSTRAINT `comments_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `uniin_universe_reh`.`tenants` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `comments_ibfk_2` FOREIGN KEY (`post_id`) REFERENCES `uniin_universe_reh`.`posts` (`id`) ON DELETE CASCADE;

ALTER TABLE `uniin_universe_reh`.`contact_inquiries`
  ADD CONSTRAINT `contact_inquiries_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `uniin_universe_reh`.`tenants` (`id`) ON DELETE CASCADE;

ALTER TABLE `uniin_universe_reh`.`layouts`
  ADD CONSTRAINT `layouts_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `uniin_universe_reh`.`tenants` (`id`) ON DELETE CASCADE;

ALTER TABLE `uniin_universe_reh`.`media`
  ADD CONSTRAINT `fk_media_folder` FOREIGN KEY (`folder_id`) REFERENCES `uniin_universe_reh`.`media_folders` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `media_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `uniin_universe_reh`.`tenants` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `media_ibfk_2` FOREIGN KEY (`uploaded_by`) REFERENCES `uniin_universe_reh`.`users` (`id`) ON DELETE SET NULL;

ALTER TABLE `uniin_universe_reh`.`media_folders`
  ADD CONSTRAINT `media_folders_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `uniin_universe_reh`.`tenants` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `media_folders_ibfk_2` FOREIGN KEY (`parent_id`) REFERENCES `uniin_universe_reh`.`media_folders` (`id`) ON DELETE CASCADE;

ALTER TABLE `uniin_universe_reh`.`migration_asset_map`
  ADD CONSTRAINT `fk_asset_map_batch` FOREIGN KEY (`batch_id`) REFERENCES `uniin_universe_reh`.`migration_batches` (`batch_id`) ON DELETE RESTRICT;

ALTER TABLE `uniin_universe_reh`.`migration_identity_map`
  ADD CONSTRAINT `fk_identity_map_batch` FOREIGN KEY (`batch_id`) REFERENCES `uniin_universe_reh`.`migration_batches` (`batch_id`) ON DELETE RESTRICT;

ALTER TABLE `uniin_universe_reh`.`migration_validation_results`
  ADD CONSTRAINT `fk_validation_batch` FOREIGN KEY (`batch_id`) REFERENCES `uniin_universe_reh`.`migration_batches` (`batch_id`) ON DELETE RESTRICT;

ALTER TABLE `uniin_universe_reh`.`notifications`
  ADD CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `uniin_universe_reh`.`users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `notifications_ibfk_2` FOREIGN KEY (`tenant_id`) REFERENCES `uniin_universe_reh`.`tenants` (`id`) ON DELETE CASCADE;

ALTER TABLE `uniin_universe_reh`.`pages`
  ADD CONSTRAINT `pages_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `uniin_universe_reh`.`tenants` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `pages_ibfk_2` FOREIGN KEY (`author_id`) REFERENCES `uniin_universe_reh`.`users` (`id`) ON DELETE SET NULL;

ALTER TABLE `uniin_universe_reh`.`password_reset_tokens`
  ADD CONSTRAINT `fk_password_reset_user` FOREIGN KEY (`user_id`) REFERENCES `uniin_universe_reh`.`users` (`id`) ON DELETE CASCADE;

ALTER TABLE `uniin_universe_reh`.`posts`
  ADD CONSTRAINT `fk_posts_post_categories` FOREIGN KEY (`category_id`) REFERENCES `uniin_universe_reh`.`post_categories` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `posts_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `uniin_universe_reh`.`tenants` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `posts_ibfk_2` FOREIGN KEY (`featured_image_id`) REFERENCES `uniin_universe_reh`.`media` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `posts_ibfk_3` FOREIGN KEY (`author_id`) REFERENCES `uniin_universe_reh`.`users` (`id`) ON DELETE SET NULL;

ALTER TABLE `uniin_universe_reh`.`settings`
  ADD CONSTRAINT `settings_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `uniin_universe_reh`.`tenants` (`id`) ON DELETE CASCADE;

ALTER TABLE `uniin_universe_reh`.`tenant_users`
  ADD CONSTRAINT `fk_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `uniin_universe_reh`.`tenants` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_user` FOREIGN KEY (`user_id`) REFERENCES `uniin_universe_reh`.`users` (`id`) ON DELETE CASCADE;

ALTER TABLE `uniin_universe_reh`.`update_images`
  ADD CONSTRAINT `update_images_ibfk_1` FOREIGN KEY (`update_id`) REFERENCES `uniin_universe_reh`.`update_history` (`update_id`) ON DELETE CASCADE;

ALTER TABLE `uniin_universe_reh`.`user_global_roles`
  ADD CONSTRAINT `fk_user_global_roles_user` FOREIGN KEY (`user_id`) REFERENCES `uniin_universe_reh`.`users` (`id`) ON DELETE CASCADE;

ALTER TABLE `uniin_universe_reh`.`workspace_compatibility`
  ADD CONSTRAINT `fk_workspace_compatibility_batch` FOREIGN KEY (`migration_batch_id`) REFERENCES `uniin_universe_reh`.`migration_batches` (`batch_id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_workspace_compatibility_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `uniin_universe_reh`.`tenants` (`id`) ON DELETE CASCADE;
