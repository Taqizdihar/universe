# Rehearsal isolation checklist

- [ ] Confirm `uniin_universe_reh` is a separately provisioned disposable schema; it is not `defaultdb` or `uniin_universe`.
- [ ] Verify `01_rehearsal_preflight.sql` reports `PASS_EMPTY_REHEARSAL_SCHEMA` and zero existing tables. A phpMyAdmin breadcrumb is insufficient; inspect `selected_context`.
- [ ] Verify the rehearsal database user is distinct and has no access to production or development schemas. If Kroombox cannot provide separate privileges, treat credential-level isolation as unverified and do not start a rehearsal backend.
- [ ] Confirm no deployed frontend, public domain, tenant website, cron task, or worker points to rehearsal.
- [ ] Keep backups and export files outside Git. Do not copy real Super Admin credentials, password reset tokens, verification codes, or API keys.
- [ ] Before any later private backend starts, disable SMTP/Brevo, outbound notifications, webhooks, scheduled jobs, external API writes, and CDN uploads/deletes. Use isolated integration credentials or network egress controls.
- [ ] Never repoint the existing Kroombox development service or a Render tenant-facing API URL to rehearsal.
- [ ] Confirm a restore/discard procedure and operator responsibility before any later manual DML.

If a separate Kroombox database or privilege boundary is unavailable, use an approved isolated MySQL instance or defer the rehearsal. Never truncate or reuse `uniin_universe`.
