# Legacy API v1 compatibility inventory

Source of truth: `backend/server/routes/data.js`, `backend/server/routes/auth.js`, `backend/server.js`, and executable tests. The machine-readable companion is `backend/compatibility/contracts/legacy-api-v1.json`. All examples and fixtures are synthetic.

## Delivery contract

| Route | Auth | Root | Selection and ordering |
| --- | --- | --- | --- |
| `GET /api/v1/public/pages` | `x-api-key` | array of `pages.*` | tenant + published; no explicit order |
| `GET /api/v1/public/pages/:slug` | `x-api-key` | page object or 404 | exact slug, tenant + published |
| `GET /api/v1/public/posts` | `x-api-key` | array of `posts.*` plus category/text aliases | tenant + published, newest `created_at` first |
| `GET /api/v1/public/posts/:slug` | `x-api-key` | post object or 404 | exact slug, tenant + published |
| `GET /api/v1/public/settings` | `x-api-key` | flattened object or 404 | tenant settings, footer from `global_options.footer_config` |
| `GET /api/v1/public/navigation` | `x-api-key` | array of `{title,slug}` | tenant + published + navbar flag, `priority ASC` |
| `GET /api/v1/public/post-categories` | `x-api-key` | array of category rows | tenant, `name ASC`; no status filter |
| `GET /api/v1/public/posts/:post_id/comments` | `x-api-key` | array of `{id,author_name,content,created_at}` | tenant + approved, `created_at ASC` |
| `POST /api/v1/public/posts/:post_id/comments` | `x-api-key` | `{message,id}`, HTTP 201 | body `author_name`, `author_email`, `content`; target post must be published in tenant; new comment pending |

The API key resolves an **active tenant** before data routes run. Invalid or absent keys return 401. Keys, user email, internal roles, and tenant metadata are not returned by these delivery routes. The page and post list/detail responses include `tenant_id` from stored rows and many original columns because queries use `*`; consumers must not assume the manifest exhaustively lists every column. The comments list excludes author email. Error responses are objects with `error`; detail requests return 404 for missing or unpublished content. There is no list wrapper such as `{data: [...]}`.

Posts preserve `template_type`, category aliases, `excerpt`, `summary`, `description`, and content blocks. `normalizePostText` creates a delivery-oriented `content[0].body_content` for non-custom templates. Announcement posts can expose `excerpt_html`, `alert_message`, and an HTML-aware `body_content`; Article, Event, Vacancy, and Template variants take their text from different fields. Custom block arrays remain distinct. This transformation is **delivery-only** and does not rewrite saved rows. Pages include `is_contact_form_active` when parsed content is an object. `content` may originate as JSON text, an array/object, or opaque legacy text; public delivery parses valid JSON and normalizes non-breaking spaces.

The existing delivery router converts relative paths in fields containing `image`, `url`, or `src` to absolute URLs using `BASE_URL` when configured. This heuristic can also encounter non-media links; Foundation 1 records the behavior but the new media adapter deliberately identifies narrower fields and does not rewrite values. The response boundary sanitizes executable HTML and unsafe URL schemes. Adapters are internal only; a future editor must keep that public sanitization boundary.

Public settings include `site_name`/`title`, `tagline`, `logo_url`, `frontend_url`, `support_email`, `copyright_text`, `footer_text`, `social_links`, `footer_nav_1`, `footer_nav_2`, `footer_contacts`, `google_maps_url`, `address`/`alamat`. The footer values come from `global_options.footer_config`. Navigation is based on published Pages; no dedicated navigation table is needed for this contract. Equal-priority navigation items have no guaranteed SQL tie order.

The separate `GET /api/public/site/:subdomain[/:slug]` preview route requires no API key, resolves an active tenant by subdomain, defaults to `home`, prefers a published Page over a Post with the same slug, and returns `{type,page,settings,navPages}`. Its `navPages` use published Pages ordered by ID and are not filtered by navbar visibility. Its settings object differs from `/api/v1/public/settings`; in particular it does not include `active_template`. Internal CMS endpoints such as `/api/pages`, `/api/posts`, and `/api/settings` use authenticated tenant context, not an API key.

## V2 versus main

The core v1 paths and root shapes remain. `main` adds tenant-scoped category joins, active-tenant API-key checks, published-post validation before comment creation, sanitized public JSON, and redacted operational errors. These are intentional security improvements; insecure `V2` behavior is not a compatibility target. `main` also has Super Admin and password recovery changes outside this delivery contract. No Foundation 1 module is wired into public responses, so deploying it cannot change this API contract.

## Internal adapter boundary

`backend/compatibility/content.js` exposes `parseLegacyContent`, `toEditorModel`, `applyEditorChanges`, `toLegacyContent`, and `validateLegacyRoundTrip`. Patches use array paths such as `[0, 'data', 'headline']` and retain all other JSON fields. For malformed JSON, raw HTML, duplicate object keys, or non-JSON objects, the result is explicitly read-only and the original value remains available unchanged. The adapter operates on stored content, not on delivery-normalized post objects. `settings.js` interprets identity/footer values and patches `global_options` while keeping unknown fields. `navigation.js` maps published navbar Pages to `{title,slug}`. `media.js` identifies known media fields and IDs without changing URLs or treating CTA links as assets. None of these functions writes to the database.
