# Phase 1 security behavior

`main` now resolves every CMS workspace request against the database. The `x-active-tenant` header and JWT tenant claim select a workspace, but neither grants access. An active membership in an active tenant is required; the verified global Super Admin may enter shadow mode across tenants. Switching workspaces remains available to users with multiple active memberships. Requests to a suspended workspace fail even with an older JWT.

Permissions: Admin and verified Super Admin may manage all tenant resources. Co-Admin may edit content, settings, API keys, and ordinary members, but cannot assign or remove Admin or Co-Admin roles. Content Creative may edit content, media, and categories. Guest may read tenant content. The last active Admin cannot be removed. User removal only deletes the tenant membership, never the global user account. These restrictions may reject operations the old backend mistakenly allowed.

Super Admin shadow workspace selection and tenant-scoped access create an activity log entry. Shadow access fails closed if that audit write is unavailable.

Deployment settings for the backend:

- Keep the existing `JWT_SECRET` unchanged and ensure it has at least 32 UTF-8 bytes. Missing or shorter values stop the server at startup; a new value invalidates existing sessions. Never put it in Vite variables.
- Set `FRONTEND_URL` to the CMS dashboard origin. Add other trusted dashboard origins to comma-separated `CORS_ALLOWED_ORIGINS`. Authenticated APIs reject other browser origins. Public site, public content API, health, and inquiry routes allow cross-origin access without cookies.
- Supply `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`. `DB_SSL_MODE=verify` validates the server certificate; set `DB_SSL_CA` to the trusted PEM if the provider uses a private CA. `DB_SSL_MODE=disable` is for trusted internal MySQL networks only. The default is `disable` for `mysql`, localhost, and private IPv4 hosts, and `verify` for other hosts. Confirm the actual Kroombox MySQL hostname and TLS support before redeploying.

No schema migration runs at startup. This phase does not rotate existing API keys. They remain bearer credentials for public content delivery and comments, so distribute them only to intended integrations; the public content API intentionally allows any browser origin. The in-memory rate limit applies per backend process, so multiple instances do not share counters. This phase does not add external storage for those counters.

Public JSON removes executable HTML and unsafe link schemes when content is delivered, including older records; saved editorial content is left intact. Links and common rich-text tags such as paragraphs, bold text, lists, and images remain available. Existing embedded scripts or iframes will no longer appear in public responses.
