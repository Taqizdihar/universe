# UNI-VERSE Foundation 3 — schema metadata bundle (no tenant rows)

This bundle was constructed from the Aiven schema-audit CSV ZIP supplied by the administrator and the Kroombox `TABLES.csv` schema audit. It contains **schema metadata only** (table names, columns, indexes, foreign-key definitions, and collations), not users, password hashes, API keys, or tenant content.

- `aiven-source-schema.json`: 19 source legacy tables, source MySQL 8.0.45. **Foreign key `onDelete` / `onUpdate` values remain `null`**, because the Aiven CSV export did not contain these rules. Do not infer them.
- `kroombox-target-schema.json`: 28 target tables (including auth and Foundation 2 metadata), MySQL 8.4.11, with FK actions as exported.
- `UNI-VERSE_schema_comparison.json`: prior schema difference report summarizing 62 column collation differences and two duplicate source FKs.

## How to use with Codex
1. Attach these files to Codex Web and tell it to load both JSON manifests directly into `backend/migration/schemaMapping.js` `compareSchemas` rather than repeat assumed counts.
2. Since Aiven FK actions are unknown, readiness MUST remain `no_go` / `requires_review`. Run the read-only `database/audit/foreign-key-actions.sql` on Aiven to obtain actual actions.
3. On Kroombox, **the phpMyAdmin session has repeatedly used `information_schema` in `DATABASE()` despite showing `uniin_universe` in its breadcrumb**. For FK queries there, explicitly filter `TABLE_SCHEMA` and `CONSTRAINT_SCHEMA` to `uniin_universe`, or use verified correct selection inside one SQL submission.
4. Audit aggregate record counts and identity/collation conflicts separately. These manifests contain no production data.

The baseline has no DDL or DML. Do not commit private data inventories.
