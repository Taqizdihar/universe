-- MANUAL ONLY: select the isolated Kroombox CMS database in phpMyAdmin first.
CREATE TABLE IF NOT EXISTS migration_batches (
  batch_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(32) NOT NULL,
  target_environment VARCHAR(32) NOT NULL,
  source_snapshot_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  migration_type VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'planned',
  validation_summary TEXT NULL,
  sanitized_notes TEXT NULL,
  started_at DATETIME(6) NULL,
  completed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (batch_id),
  KEY idx_migration_batches_status (status, created_at),
  CONSTRAINT chk_migration_batches_source CHECK (source_system IN ('aiven_v2', 'kroombox_native', 'manual_import')),
  CONSTRAINT chk_migration_batches_target CHECK (target_environment IN ('kroombox_development', 'kroombox_staging', 'kroombox_production')),
  CONSTRAINT chk_migration_batches_fingerprint CHECK (source_snapshot_fingerprint REGEXP '^[0-9a-fA-F]{64}$'),
  CONSTRAINT chk_migration_batches_type CHECK (migration_type IN ('rehearsal', 'cutover', 'reconciliation')),
  CONSTRAINT chk_migration_batches_status CHECK (status IN ('planned', 'prepared', 'validated', 'approved', 'applied', 'failed', 'rolled_back', 'reconciled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
