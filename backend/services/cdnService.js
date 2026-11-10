const axios = require('axios');
const FormData = require('form-data');

const CDN_BASE_URL = 'https://api-cdn.kroombox.com/api/bridge';

/**
 * Extract Google Drive file ID from various URL formats:
 * - https://drive.google.com/uc?id=DRIVE_ID&export=download
 * - https://drive.google.com/file/d/DRIVE_ID/view
 * - https://drive.google.com/open?id=DRIVE_ID
 * - lh3.googleusercontent.com URLs (already viewable — pass through)
 *
 * @param {string} url
 * @returns {string|null} The extracted Drive file ID, or null if not a Drive URL
 */
function extractDriveFileId(url) {
  if (!url || typeof url !== 'string') return null;

  // Pattern 1: uc?id=DRIVE_ID or open?id=DRIVE_ID
  const idParam = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return idParam[1];

  // Pattern 2: /file/d/DRIVE_ID/
  const fileD = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileD) return fileD[1];

  // Pattern 3: /d/DRIVE_ID/
  const dSlash = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dSlash) return dSlash[1];

  return null;
}

/**
 * Transform a CDN response URL into a viewable preview URL.
 *
 * - Images  → Google Thumbnail API for reliable high-res rendering
 * - Videos  → Kroombox bridge/view endpoint (handles streaming headers)
 * - Others  → Kroombox bridge/view endpoint
 *
 * @param {string} rawUrl  - The URL returned by the CDN (may contain &export=download)
 * @param {string} mimeType
 * @param {string} fileId  - The Kroombox/Drive file ID
 * @returns {string} A viewable (non-download) URL
 */
function transformToViewableUrl(rawUrl, mimeType, fileId) {
  const isImage = mimeType && mimeType.startsWith('image/');
  const isVideo = mimeType && mimeType.startsWith('video/');

  if (isImage) {
    // Try to extract a Google Drive ID from the raw URL
    const driveId = extractDriveFileId(rawUrl);

    if (driveId) {
      // Best practice: Google Thumbnail API — reliable, no download prompt
      return `https://drive.google.com/thumbnail?id=${driveId}&sz=w1600`;
    }

    // If the URL is already an lh3.googleusercontent.com link, it's viewable
    if (rawUrl && rawUrl.includes('lh3.googleusercontent.com')) {
      return rawUrl;
    }

    // Fallback: strip &export=download if present
    if (rawUrl && rawUrl.includes('&export=download')) {
      return rawUrl.replace('&export=download', '');
    }

    // Final fallback: Kroombox view endpoint
    if (fileId) {
      return `${CDN_BASE_URL}/view/${fileId}`;
    }

    return rawUrl || '';
  }

  if (isVideo) {
    // Videos: Kroombox view endpoint handles streaming headers better
    if (fileId) {
      return `${CDN_BASE_URL}/view/${fileId}`;
    }
    return rawUrl || '';
  }

  // Documents & other types
  if (fileId) {
    return `${CDN_BASE_URL}/view/${fileId}`;
  }
  return rawUrl || '';
}

/**
 * Helper: Determines the best URL to store based on file type.
 * - Images → Google Thumbnail API for reliable preview/embed
 * - Videos & Documents → Kroombox view endpoint
 */
function resolveFileUrl(cdnResponse, mimeType) {
  const fileId = cdnResponse.fileId || cdnResponse.id;
  const physicalUrl = cdnResponse.url || cdnResponse.webContentLink || cdnResponse.directUrl;

  return transformToViewableUrl(physicalUrl, mimeType, fileId);
}

const cdnService = {
  /**
   * Upload a file to Kroombox CDN.
   * @param {Buffer} fileBuffer - Raw file data
   * @param {string} originalName - Original filename
   * @param {string} mimeType - MIME type
   * @param {string} projectName - Full hierarchical path (e.g. "tenant_9/Aset_Promosi/Jan_2026")
   * @returns {Object} { fileId, url, status, mimeType, size, originalName }
   */
  upload: async (fileBuffer, originalName, mimeType, projectName) => {
    try {
      const apiKey = process.env.CDN_API_KEY;
      if (!apiKey) throw new Error('CDN_API_KEY is not configured in environment variables');

      const formData = new FormData();
      formData.append('file', fileBuffer, {
        filename: originalName,
        contentType: mimeType,
      });
      formData.append('projectName', projectName);

      // Include PROJECT_ID if available (registered project identifier)
      const projectId = process.env.CDN_PROJECT_ID;
      if (projectId) {
        formData.append('projectId', projectId);
      }

      console.log(`[CDN] Upload started (${mimeType}, ${fileBuffer.length} bytes)`);

      const response = await axios.post(`${CDN_BASE_URL}/upload`, formData, {
        headers: {
          ...formData.getHeaders(),
          'x-api-key': apiKey,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const data = response.data;

      const fileId = data.fileId || data.id;

      if (!fileId) {
        console.error('[CDN] Upload response contained no file identifier.');
        throw new Error('CDN returned no file identifier');
      }

      // Smart URL resolution — transforms to viewable preview URL
      const resolvedUrl = resolveFileUrl(data, mimeType);

      console.log('[CDN] Upload completed.');

      return {
        fileId,
        url: resolvedUrl,
        status: data.status || 'ready',
        mimeType: data.mimeType || mimeType,
        size: data.size || data.fileSize || null,
        originalName: data.originalName || data.fileName || originalName,
      };
    } catch (error) {
      console.error('[CDN] Upload failed.', { status: error.response?.status || null, code: error.code || null });
      throw new Error('Failed to upload to CDN');
    }
  },

  /**
   * Delete a file from Kroombox CDN.
   * @param {string} fileId - The Kroombox file ID
   */
  delete: async (fileId) => {
    try {
      const apiKey = process.env.CDN_API_KEY;
      if (!apiKey) throw new Error('CDN_API_KEY is not configured');

      const response = await axios.delete(`${CDN_BASE_URL}/files/${fileId}`, {
        headers: {
          'x-api-key': apiKey,
        },
      });

      console.log('[CDN] Delete completed.');
      return response.data;
    } catch (error) {
      console.error('[CDN] Delete failed.', { status: error.response?.status || null, code: error.code || null });
      throw new Error('Failed to delete from CDN');
    }
  },

  /**
   * Check file status from Kroombox CDN (for processing state).
   * When status becomes 'ready', transforms the URL to a viewable preview.
   * @param {string} fileId - The Kroombox file ID
   * @param {string} [mimeType] - Optional MIME type for smart URL transformation
   * @returns {Object} { status, url }
   */
  getStatus: async (fileId, mimeType) => {
    try {
      const apiKey = process.env.CDN_API_KEY;
      if (!apiKey) throw new Error('CDN_API_KEY is not configured');

      const response = await axios.get(`${CDN_BASE_URL}/status/${fileId}`, {
        headers: {
          'x-api-key': apiKey,
        },
      });

      let result = response.data;

      // Handle Kroombox Server-Sent Events (SSE) format
      if (typeof result === 'string') {
        const events = result.split('\n\n').filter(Boolean);
        for (let i = events.length - 1; i >= 0; i--) {
          const event = events[i].trim();
          if (event.startsWith('data: ')) {
            try {
              result = JSON.parse(event.substring(6));
              break;
            } catch (err) {
              console.error('[CDN] Failed to parse SSE chunk.');
            }
          }
        }
      }
      
      // Task 1: If ready, fetch full details to get the physical URL, then transform it
      if (result.status === 'ready') {
        let physicalUrl = result.url; // Prefer the URL directly from the SSE stream if available
        
        if (!physicalUrl || physicalUrl.includes('/api/bridge/view/')) {
          try {
            const detailRes = await axios.get(`${CDN_BASE_URL}/files/${fileId}`, {
              headers: { 'x-api-key': apiKey },
            });
            const detail = detailRes.data;
            physicalUrl = detail.url || detail.webContentLink || detail.directUrl;
          } catch(detailErr) {
            console.error('[CDN] Failed to fetch full details for physical URL, using stream fallback:', detailErr.code || 'UNKNOWN');
          }
        }
        
        // Transform to viewable URL instead of download URL
        result.url = transformToViewableUrl(physicalUrl, mimeType || '', fileId);
        console.log('[CDN] Status ready.');
      }

      return result;
    } catch (error) {
      console.error('[CDN] Status Check Error:', { status: error.response?.status || null, code: error.code || null });
      return { status: 'unknown' };
    }
  }
};

module.exports = cdnService;
