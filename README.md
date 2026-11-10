<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/1e915d99-52a7-4e57-b4c1-904e9cd0c277

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Backend database on main (V3)

Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in the backend runtime environment. The backend fails to start if any are missing. Use the Kroombox MySQL credentials for the Kroombox deployment; never reuse the production Aiven connection.

The backend does not change the database schema on startup, media upload, or activity logging. Apply schema changes separately in phpMyAdmin or, after checking the target database, run the optional legacy migration steps with `npm run migrate:schema --prefix backend`. These steps assume the base CMS tables already exist; they do not create a complete database from scratch. The selected database must include `media.status` and the `activity_logs` table before those features are used.
