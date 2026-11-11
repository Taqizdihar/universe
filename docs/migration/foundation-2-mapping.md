# Foundation 2 identity and workspace mapping

Foundation 2 adds **empty metadata tables** and an offline planner. It does not read, copy, or change tenant records. Existing routes, login, and Legacy API v1 continue to use the legacy schema. The metadata tables are not required at application startup. See [`../../database/migrations/foundation-2/README.md`](../../database/migrations/foundation-2/README.md) for the manual installation sequence.

## Identity policy

The batch's source snapshot is identified by a SHA-256 fingerprint; the fingerprint identifies an administrator-held snapshot and is not a database credential. Within one batch, each `(source_system, entity_type, source_record_id)` maps at most once, and each `(entity_type, target_record_id)` can be claimed at most once. Target IDs may differ from source IDs. A missing target ID means a proposal, not an allocation. The database tables hold mapping metadata only; the planner makes no target writes.

The offline planner reports same-number/different-user collisions, email matches, occupied target IDs, protected target Super Admin IDs, duplicate subdomains, API-key fingerprint collisions, missing references, cross-tenant content references, and mapping duplicates. It never considers an email or numeric ID sufficient proof of identity. Existing global roles require explicit review; legacy recovery tokens and password hashes are outside the planner's entity registry and must not be copied. API-key fingerprints in synthetic manifests must be non-reversible digests, never key values.

`workspace_compatibility` defaults to `kroombox_native`, `legacy_compatible`, and `legacy-api-v1`. It has one row at most per tenant. No row is created automatically. A workspace may acquire `verified_at` only after a migration batch and documented successful validation; a failed or pending check blocks the planner from advancing a batch to `validated`. Human approval and manual application evidence are separate later status transitions.

## Dependencies and references

`backend/migration/planner.js` declares the entity dependency order. The first required entities are users and tenants, followed by memberships, roles, API-key records, content categories, folders, media, content, and related tenant data. The planner's manifests use synthetic or sanitized identity fields only. For a source table without a simple numeric primary key, the administrator must supply a stable, non-sensitive surrogate record ID in the manifest. The planner rejects unknown tables, including authentication verification and password-reset tables.

`migration_asset_map` identifies DB media IDs and CDN file IDs by opaque IDs and reference types. It does not store URLs, copy files, rewrite nested JSON, or treat internal navigation and external CTA links as media. URL classes are included only to distinguish their reference type for future review.

## Readiness for a future rehearsal

The Aiven V2 schema inventory has **not** been supplied. The source-to-target schema comparison and field-level transformations are therefore incomplete. An administrator must run the read-only schema audit files in the corresponding databases, compare types, indexes, foreign keys, charset/collation, and the authentication tables, then document every difference. A later rehearsal needs an approved, sanitized source snapshot, an explicit identity plan, validation of tenant ownership and Legacy API v1 round trips, verified backups, and a separately reviewed manual SQL package. This phase does not provide an execution tool or authorize a tenant-data transfer.
