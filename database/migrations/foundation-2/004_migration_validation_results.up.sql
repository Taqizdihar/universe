CREATE TABLE IF NOT EXISTS migration_validation_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  check_id VARCHAR(100) NOT NULL,
  entity_type VARCHAR(40) NOT NULL DEFAULT 'batch',
  expected_summary VARCHAR(500) NULL,
  actual_summary VARCHAR(500) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  sanitized_diagnostic TEXT NULL,
  verified_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_validation_batch_check (batch_id, check_id, entity_type),
  KEY idx_validation_batch_status (batch_id, status),
  CONSTRAINT fk_validation_batch FOREIGN KEY (batch_id) REFERENCES migration_batches(batch_id) ON DELETE RESTRICT,
  CONSTRAINT chk_validation_status CHECK (status IN ('pending', 'passed', 'failed', 'waived')),
  CONSTRAINT chk_validation_verified CHECK (verified_at IS NULL OR status IN ('passed', 'waived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
