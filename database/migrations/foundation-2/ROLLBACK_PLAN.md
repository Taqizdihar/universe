# Rollback and partial-install recovery

MySQL DDL is not rolled back as one transaction. Keep a verified Kroombox backup before manual execution. If any file fails, stop and inspect which of the five tables exist. Do not automatically drop or recreate anything.

If all five metadata tables are empty and a rollback is explicitly approved, an administrator can plan a manual reverse dependency order: `migration_asset_map`, `migration_validation_results`, `migration_identity_map`, `workspace_compatibility`, then `migration_batches`. Verify zero rows and a restorable backup **before** considering any DROP. This repository intentionally contains no executable destructive rollback script. Never drop legacy `tenants`, `users`, `api_keys`, `account_auth_state`, or `password_reset_tokens` as part of Foundation 2.

If metadata rows have been created, dropping the tables would lose mapping/validation audit history. Reconcile records and restore from a verified backup only under a separately reviewed operation. An application rollback needs no database rollback because normal startup and Legacy API v1 never read these new tables.
