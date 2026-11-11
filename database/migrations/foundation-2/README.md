# Foundation 2: manual metadata schema package

This package is **not executed by the application**. It creates empty planning metadata tables only. No legacy table is altered, no tenant row is inserted, and no account, role, API key, password recovery state, or content is touched.

## Before running anything

1. Confirm the selected phpMyAdmin database is the isolated Kroombox development CMS database, not Aiven. Record its name and MySQL version. Make and verify a Kroombox database backup.
2. Confirm the expected legacy tables and already-applied `account_auth_state` and `password_reset_tokens` exist. The five new tables should not already exist. Run `foundation-2.preflight.sql` in the SQL tab and review **every** result set. Every required table/column/index check should be `PASS`; the final pre-existing-table result should be empty. If any check fails or any new table already exists, stop and inspect rather than relying on `IF NOT EXISTS`.
3. Do not copy actual tenant records, API key values, credentials, or dump files into this repository or the migration metadata tables.

## Manual execution order in phpMyAdmin

Select the target database in the sidebar, open **SQL**, paste and execute each file separately in this exact order:

1. `001_migration_batches.up.sql`
2. `002_workspace_compatibility.up.sql`
3. `003_migration_identity_map.up.sql`
4. `004_migration_validation_results.up.sql`
5. `005_migration_asset_map.up.sql`
6. Run read-only `foundation-2.verify.sql`.

The batch table comes first because the other metadata tables reference it. `workspace_compatibility` also references existing `tenants.id`. `IF NOT EXISTS` makes a repeated create harmless only when the existing definition is identical; it does **not** repair a mismatched table. The verification queries check engine/collation, important columns, unique keys, foreign keys, and check constraints. Every schema check must be `PASS`; all three issue result sets must be empty. Exact row counts should be zero for all five metadata tables immediately after a fresh installation. If the SQL tab reports an error, stop at that file, inspect phpMyAdmin's message and the current schema, and do not proceed to a dependent file.

No automatic data backfill is part of this package. A later administrator-reviewed process may create records only after schema comparison and mapping validation. `approved` is distinct from `applied`; neither is set by these scripts. The planner in `backend/migration/planner.js` is offline and does not connect to MySQL.

For schema-only comparison, the administrator may separately run `database/audit/aiven-v2-schema.sql` in Aiven and `database/audit/kroombox-target-schema.sql` in Kroombox. Both read `information_schema` only. Review exported metadata before sharing; do not export table data or credentials. The actual Aiven schema inventory is not yet available, so a complete source-to-target schema map remains incomplete.
