/**
 * Path Helper — Builds hierarchical CDN paths from MySQL media_folders.
 * 
 * Target Format: ${PROJECT_ID}/tenant_${tid}[/${folderName}]
 * This forces Kroombox to create isolated folders mirroring the CMS structure.
 */

const db = require('../server/lib/db');

/**
 * Sanitize a folder name for use in a CDN path segment.
 */
function sanitizeFolderName(name) {
  if (!name) return '';
  return name
    .trim()
    .replace(/[\/\\:*?"<>|]/g, '') // remove illegal path chars
    .replace(/\s+/g, '_');          // spaces → underscores
}

/**
 * Build the full CDN project path for a given tenant + optional folder.
 * 
 * @param {number} tenantId - The tenant ID
 * @param {number|null} folderId - The CMS media_folders.id (null = root)
 * @returns {Promise<string>} e.g. "project-id/tenant_9/Aset_Promosi"
 */
async function buildCdnPath(tenantId, folderId) {
  const projectId = process.env.CDN_PROJECT_ID;
  if (!projectId) throw new Error('CDN_PROJECT_ID is required for uploads.');
  let path = `${projectId}/tenant_${tenantId}`;

  if (folderId) {
    const [rows] = await db.execute(
      'SELECT name FROM media_folders WHERE id = ? AND tenant_id = ?',
      [folderId, tenantId]
    );
    if (!rows.length) throw new Error('Folder not found in the active workspace.');
    const folderName = sanitizeFolderName(rows[0].name);
    path += `/${folderName}`;
  }

  return path;
}

module.exports = { buildCdnPath, sanitizeFolderName };
