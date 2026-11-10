# Super Admin bootstrap on Kroombox

The schema-only Kroombox database must already contain `users`, `user_global_roles`, and `super_admin_verifications`. The fixed owner mailbox is in `backend/config/superAdmin.js`; no `SUPER_ADMIN_EMAIL` environment variable is needed. `JWT_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` must be configured for the backend.

Do not use ordinary registration for the owner mailbox. The backend reserves it for the verified bootstrap flow. The first user will normally receive ID 1 in an empty database, but super admin authorization depends on the persisted global role and reserved mailbox, never on ID 1.

1. Send `POST /api/auth/super-admin/request-code` with JSON `{ "email": "m.taqizdihar@gmail.com" }` to the same API origin used by the CMS login. A six-digit code is emailed to the owner mailbox. Requests are rate limited, and a new code can be requested after 60 seconds. Each code expires after 10 minutes.
2. Send `POST /api/auth/super-admin/complete` with JSON `{ "email": "m.taqizdihar@gmail.com", "code": "123456", "name": "Your name", "newPassword": "your new password", "confirmPassword": "your new password" }`. Use the actual emailed code and a matching password of 12–128 characters. The code can be used once and allows at most five failed attempts.
3. Sign in through the existing CMS login form with the owner email and new password. No tenant row or tenant membership is needed for the global super admin account.

The same two endpoints perform email-verified password recovery after the account exists. Password recovery invalidates older super admin access tokens; sign in again afterward. Codes and passwords are never returned by the API or written to request logs.
