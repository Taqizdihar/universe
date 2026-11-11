# Foundation 1 readiness for future identity mapping

This phase adds only pure compatibility modules, synthetic fixtures, a contract manifest, and tests. It introduces no schema or stored-row changes. Do not infer live Aiven or Kroombox state from an old dump.

## Existing identities and dependencies

- `users` are global identities; `tenant_users` links users to `tenants` with roles/status. Do not map a person by tenant-local role alone.
- `api_keys` identify tenant delivery integrations. Preserve existing key values and tenant association during any later mapping; never regenerate keys as a migration shortcut.
- `pages`, `posts`, `post_categories`, `settings`, `layouts`, `media`, and `media_folders` are tenant-scoped legacy content. The historical schema declares foreign keys for `posts.category_id` and `posts.featured_image_id`; nested references inside JSON content are not covered by those constraints. Verify actual Kroombox constraints before planning a mapping.
- `comments` refer to posts/tenants; `notifications`, `contact_inquiries`, and `activity_logs` carry operational history that should not be collapsed into content entries.
- Auth changes on `main` add password recovery/session state. A future content migration must not alter user IDs, password hashes, roles, sessions, or Super Admin identity.

## Mapping and staging risks

Keep legacy row IDs and tenant IDs stable until a reviewed mapping defines new IDs. New schema entries need namespaced identity keys to avoid collisions between Pages, Posts, and future content models. Preserve exact slug, publication status, `priority`, navbar visibility, category association, and `global_options` footer fields. JSON text may contain ordered block arrays, unknown block types, unknown nested keys, nulls, HTML, malformed values, or duplicate object keys; the adapter marks opaque and ambiguous content read-only. Compare semantic round trips before writing anything. Saved rich text and public sanitized HTML are different layers; do not save delivery-normalized text back into legacy rows.

Keep `media.id`, `filename`, `file_name`, `file_url`, `folder_id`, tenant ownership, and nested media references distinct. A relative URL, an absolute CDN URL, a Google Drive URL, and a `data:` URL may refer to different systems. A CTA link is not a media asset. No media URL rewrite, CDN operation, or file move belongs to Foundation 1.

Before Foundation 2, an administrator must verify the actual Kroombox schema and tenant/API-key ownership with read-only checks, approve an identity mapping plan, provide a staging copy without live tenant personal data, and review any future SQL. DDL/DML must be manually applied through Kroombox phpMyAdmin only after a separate review. Introduce a Content Schema Registry only when legacy contract tests pass, identity mappings are stable, opaque content is accounted for, tenant isolation is preserved, and rollback criteria are documented.
