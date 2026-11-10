/**
 * ============================================================
 *  Cloudinary → Kroombox CDN — One-Time Migration Script
 * ============================================================
 *
 *  Usage:
 *    node backend/scripts/migrateCloudinary.js
 *    — OR —
 *    GET /api/admin/start-migration  (Super Admin only)
 *
 *  What it does:
 *    1. Finds all media records whose file_url contains "cloudinary.com"
 *    2. Downloads each file to a local temp folder
 *    3. Uploads it to Kroombox CDN via the bridge API
 *    4. Updates MySQL: file_url → https://drive.google.com/thumbnail?id=[fileId]&sz=w1200 (images),
 *       status → "ready", filename → new CDN fileId
 *    5. Deletes the temp file
 *
 *  Safety:
 *    - Processes in batches of 5 to avoid memory/API pressure
 *    - A single file failure does NOT stop the script
 *    - Detailed per-file logging to console
 * ============================================================
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const db = require('../server/lib/db');
const cdnService = require('../services/cdnService');
const { buildCdnPath } = require('../utils/pathHelper');

// ── Configuration ──────────────────────────────────────────
const BATCH_SIZE = 5;
const TEMP_DIR = path.resolve(__dirname, '..', 'temp_migration');

// ── Helpers ────────────────────────────────────────────────

/**
 * Ensure the temp directory exists.
 */
function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    console.log(`[MIGRATE] 📁 Created temp directory: ${TEMP_DIR}`);
  }
}

/**
 * Download a file from a URL to the temp directory.
 * Returns the local file path.
 */
async function downloadToTemp(url, filename) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const localPath = path.join(TEMP_DIR, `${Date.now()}_${safeName}`);

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 60000, // 60s timeout
  });

  const writer = fs.createWriteStream(localPath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(localPath));
    writer.on('error', reject);
  });
}

/**
 * Delete a file from the temp directory (silent on failure).
 */
function cleanupTempFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.warn(`[MIGRATE] ⚠ Could not delete temp file: ${filePath}`);
  }
}

/**
 * Process a batch of media records concurrently.
 * Returns { successes, failures } counts.
 */
async function processBatch(batch, batchIndex, totalCount) {
  let successes = 0;
  let failures = 0;

  // Process each item in the batch sequentially to avoid overwhelming the CDN API
  for (const media of batch) {
    const globalIndex = batchIndex + batch.indexOf(media) + 1;
    const displayName = media.file_name || media.filename || `ID:${media.id}`;
    let tempFilePath = null;

    try {
      console.log(`\n  [${globalIndex}/${totalCount}] Migrating: ${displayName}`);
      console.log(`    📥 Downloading from Cloudinary...`);

      // ── Step 2: Download to temp ──
      tempFilePath = await downloadToTemp(
        media.file_url,
        displayName
      );

      const fileBuffer = fs.readFileSync(tempFilePath);
      const fileSize = fileBuffer.length;

      console.log(`    ✓ Downloaded (${(fileSize / 1024).toFixed(1)} KB)`);

      // ── Step 3: Upload to Kroombox ──
      console.log(`    📤 Uploading to Kroombox CDN...`);

      const cdnPath = await buildCdnPath(media.tenant_id, media.folder_id || null);
      const mimeType = media.file_type || 'application/octet-stream';

      const cdnResponse = await cdnService.upload(
        fileBuffer,
        displayName,
        mimeType,
        cdnPath
      );

      const newFileId = cdnResponse.fileId;

      if (!newFileId) {
        throw new Error('CDN returned no fileId');
      }

      console.log(`    ✓ Uploaded → fileId: ${newFileId}`);

      // ── Step 4: Update MySQL ──
      // Use the same URL-mapping logic as buildMediaUrl in server.js
      const normalizedMimeType = mimeType.toLowerCase();
      let newFileUrl;
      if (normalizedMimeType.startsWith('image/')) {
        newFileUrl = `https://drive.google.com/thumbnail?id=${newFileId}&sz=w1200`;
      } else if (normalizedMimeType.startsWith('video/')) {
        newFileUrl = `https://drive.google.com/file/d/${newFileId}/preview`;
      } else if (normalizedMimeType === 'application/pdf') {
        newFileUrl = `https://drive.google.com/file/d/${newFileId}/preview`;
      } else {
        newFileUrl = `https://api-cdn.kroombox.com/api/bridge/view/${newFileId}`;
      }

      await db.execute(
        `UPDATE media 
         SET filename = ?, file_url = ?, status = ?, file_size = COALESCE(?, file_size)
         WHERE id = ?`,
        [newFileId, newFileUrl, 'ready', cdnResponse.size || fileSize, media.id]
      );

      console.log(`    ✓ DB updated → ${newFileUrl}`);
      console.log(`    ✅ SUCCESS`);
      successes++;

    } catch (err) {
      console.error(`    ❌ FAILED: ${err.message}`);
      failures++;
    } finally {
      // ── Step 5: Cleanup temp file ──
      cleanupTempFile(tempFilePath);
    }
  }

  return { successes, failures };
}

// ── Main Migration Function ────────────────────────────────

async function migrateCloudinaryToKroombox() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Cloudinary → Kroombox CDN Migration Tool   ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  const startTime = Date.now();

  try {
    // ── Step 1: Fetch all Cloudinary records ──
    const [rows] = await db.execute(
      "SELECT * FROM media WHERE file_url LIKE '%cloudinary.com%'"
    );

    console.log(`📊 Found ${rows.length} media assets still hosted on Cloudinary.\n`);

    if (rows.length === 0) {
      console.log('🎉 Nothing to migrate — all assets are already on Kroombox CDN!');
      return {
        total: 0,
        migrated: 0,
        failed: 0,
        elapsed: '0s',
      };
    }

    // Create temp directory
    ensureTempDir();

    let totalSuccess = 0;
    let totalFailed = 0;

    // ── Process in batches ──
    const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

    for (let b = 0; b < totalBatches; b++) {
      const start = b * BATCH_SIZE;
      const batch = rows.slice(start, start + BATCH_SIZE);

      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`  Batch ${b + 1}/${totalBatches}  (items ${start + 1}–${start + batch.length} of ${rows.length})`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      const { successes, failures } = await processBatch(batch, start, rows.length);
      totalSuccess += successes;
      totalFailed += failures;

      // Brief pause between batches to avoid rate limiting
      if (b < totalBatches - 1) {
        console.log(`\n  ⏳ Waiting 2s before next batch...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // ── Cleanup temp directory ──
    try {
      const remaining = fs.readdirSync(TEMP_DIR);
      if (remaining.length === 0) {
        fs.rmdirSync(TEMP_DIR);
        console.log(`\n📁 Temp directory cleaned up.`);
      } else {
        console.log(`\n⚠ Temp directory has ${remaining.length} leftover files: ${TEMP_DIR}`);
      }
    } catch (e) { /* ignore */ }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║           Migration Complete                 ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Total:    ${String(rows.length).padStart(5)}                           ║`);
    console.log(`║  ✅ OK:    ${String(totalSuccess).padStart(5)}                           ║`);
    console.log(`║  ❌ Fail:  ${String(totalFailed).padStart(5)}                           ║`);
    console.log(`║  ⏱ Time:  ${String(elapsed + 's').padStart(7)}                         ║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    // Final verification
    const [remaining] = await db.execute(
      "SELECT COUNT(*) as count FROM media WHERE file_url LIKE '%cloudinary.com%'"
    );
    console.log(`📋 Remaining Cloudinary records: ${remaining[0].count}`);

    if (remaining[0].count === 0) {
      console.log('🎉 GOAL ACHIEVED: 0 records left with Cloudinary URLs!');
    } else {
      console.log(`⚠ ${remaining[0].count} records still need migration (re-run the script to retry).`);
    }

    return {
      total: rows.length,
      migrated: totalSuccess,
      failed: totalFailed,
      remaining: remaining[0].count,
      elapsed: elapsed + 's',
    };

  } catch (error) {
    console.error('\n💀 FATAL MIGRATION ERROR:', error);
    throw error;
  }
}

// ── Export for route usage & CLI execution ──────────────────

module.exports = { migrateCloudinaryToKroombox };

// If run directly from CLI: `node backend/scripts/migrateCloudinary.js`
if (require.main === module) {
  migrateCloudinaryToKroombox()
    .then(result => {
      console.log('\nFinal result:', JSON.stringify(result, null, 2));
      process.exit(result && result.failed > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error('Unhandled error:', err);
      process.exit(1);
    });
}
