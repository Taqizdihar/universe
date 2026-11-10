// =============================================================
// Public Data Routes — Content Delivery API
// =============================================================
// Serves published content to frontend consumers.
//   GET  /posts                       → Published posts
//   POST /posts/:post_id/comments     → Submit a comment
//   GET  /posts/:post_id/comments     → Approved comments
//   GET  /pages                       → Published pages
//   GET  /navigation                  → Navbar-visible pages
//   GET  /settings                    → Site identity & branding
//
// All routes are protected by the apiAuth middleware which
// validates the x-api-key header and resolves req.api_tenant_id.
// =============================================================

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const apiAuth = require('../../middleware/apiAuth');
const { deepSanitizeContent } = require('../../utils/sanitizeHtml');
const { normalizePostText } = require('../../utils/postText');

// Apply API-key authentication to all data routes
router.use(apiAuth);

// =============================================================
// Utility: Absolute Media URL Normalization
// =============================================================
// Ensures all relative media URLs (from uploads or local paths)
// are converted to fully-qualified absolute URLs using BASE_URL.
// Already-absolute URLs (http/https/data:) are passed through.
// =============================================================

const normalizeUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
        return url;
    }
    const baseUrl = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : '';
    const path = url.startsWith('/') ? url : `/${url}`;
    return `${baseUrl}${path}`;
};

// =============================================================
// Utility: Deep Content Image Normalization
// =============================================================
// Recursively traverses Block Builder JSON content and normalizes
// any keys containing 'image', 'url', or 'src' to absolute URLs.
// Handles both string and pre-parsed JSON content.
// =============================================================

const normalizeContentImages = (content) => {
    if (!content) return content;
    
    let parsed = content;
    if (typeof content === 'string') {
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            return content;
        }
    }

    const traverse = (obj) => {
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                if (typeof obj[i] === 'object' && obj[i] !== null) traverse(obj[i]);
            }
        } else if (typeof obj === 'object' && obj !== null) {
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    if (
                       (key.includes('image') || key.includes('url') || key === 'src') 
                       && typeof obj[key] === 'string'
                    ) {
                        obj[key] = normalizeUrl(obj[key]);
                    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                        traverse(obj[key]);
                    }
                }
            }
        }
    };

    if (typeof parsed === 'object' && parsed !== null) {
        traverse(parsed);
    }
    
    return parsed;
};

// =============================================================
// GET /posts — Published posts with Dynamic Block content
// =============================================================
router.get('/posts', async (req, res) => {
    try {
        const tenantId = req.api_tenant_id;
        const [posts] = await db.execute(
            `SELECT posts.*, post_categories.name AS category_name, post_categories.slug AS category_slug
             FROM posts
             LEFT JOIN post_categories ON posts.category_id = post_categories.id AND post_categories.tenant_id = posts.tenant_id
             WHERE posts.tenant_id = ? AND posts.status = 'published'
             ORDER BY posts.created_at DESC`, 
            [tenantId]
        );
        
        const normalizedPosts = posts.map(post => {
            if (post.featured_image) {
                post.featured_image = normalizeUrl(post.featured_image);
            }
            if (post.content) {
                post.content = normalizeContentImages(post.content);
                // Sanitize legacy &nbsp; entities from database records
                post.content = deepSanitizeContent(post.content);
            }
            return normalizePostText(post);
        });

        res.json(normalizedPosts);
    } catch (error) {
        console.error('[PUBLIC API ERROR] Get posts:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// GET /posts/:slug — Get a single published post by slug
// =============================================================
router.get('/posts/:slug', async (req, res) => {
    try {
        const tenantId = req.api_tenant_id;
        const { slug } = req.params;

        const [rows] = await db.execute(
            `SELECT posts.*, post_categories.name AS category_name, post_categories.slug AS category_slug
             FROM posts
             LEFT JOIN post_categories ON posts.category_id = post_categories.id AND post_categories.tenant_id = posts.tenant_id
             WHERE posts.tenant_id = ? AND posts.slug = ? AND posts.status = 'published'
             LIMIT 1`,
            [tenantId, slug]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Post not found.' });
        }

        const post = rows[0];
        if (post.featured_image) {
            post.featured_image = normalizeUrl(post.featured_image);
        }
        if (post.content) {
            post.content = normalizeContentImages(post.content);
            // Sanitize legacy &nbsp; entities from database records
            post.content = deepSanitizeContent(post.content);
        }

        res.json(normalizePostText(post));
    } catch (error) {
        console.error('[PUBLIC API ERROR] Get single post:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// POST /posts/:post_id/comments — Submit a new comment
// =============================================================
// Inserts a comment with status 'pending' (requires moderation).
// Validates author_name, author_email, and content.
// =============================================================

router.post('/posts/:post_id/comments', async (req, res) => {
    try {
        const tenantId = req.api_tenant_id;
        const { post_id } = req.params;
        const { author_name, author_email, content } = req.body;

        // Input validation
        if (!author_name || !author_name.trim()) {
            return res.status(400).json({ error: 'author_name is required.' });
        }
        if (!author_email || !author_email.trim()) {
            return res.status(400).json({ error: 'author_email is required.' });
        }
        if (!content || !content.trim()) {
            return res.status(400).json({ error: 'content is required.' });
        }

        // Basic email format check
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(author_email.trim())) {
            return res.status(400).json({ error: 'author_email format is invalid.' });
        }

        // Verify the post exists and belongs to this tenant
        const [posts] = await db.execute(
            "SELECT id FROM posts WHERE id = ? AND tenant_id = ? AND status = 'published'",
            [post_id, tenantId]
        );
        if (posts.length === 0) {
            return res.status(404).json({ error: 'Post not found.' });
        }

        const [result] = await db.execute(
            `INSERT INTO comments (post_id, tenant_id, author_name, author_email, content, status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [post_id, tenantId, author_name.trim(), author_email.trim(), content.trim()]
        );

        res.status(201).json({
            message: 'Comment submitted successfully. It will appear after moderation.',
            id: result.insertId
        });
    } catch (error) {
        console.error('[PUBLIC API ERROR] Submit comment:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// GET /posts/:post_id/comments — Approved comments for a post
// =============================================================
// Returns only comments with status = 'approved', sorted by
// creation date ascending (oldest first, like a conversation).
// =============================================================

router.get('/posts/:post_id/comments', async (req, res) => {
    try {
        const tenantId = req.api_tenant_id;
        const { post_id } = req.params;

        const [comments] = await db.execute(
            `SELECT id, author_name, content, created_at
             FROM comments
             WHERE post_id = ? AND tenant_id = ? AND status = 'approved'
             ORDER BY created_at ASC`,
            [post_id, tenantId]
        );

        res.json(comments);
    } catch (error) {
        console.error('[PUBLIC API ERROR] Get comments:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// GET /pages — Published pages with slug filtering
// =============================================================
router.get('/pages', async (req, res) => {
    try {
        const tenantId = req.api_tenant_id;
        const [pages] = await db.execute(
            "SELECT * FROM pages WHERE tenant_id = ? AND status = 'published'", 
            [tenantId]
        );
        
        const normalizedPages = pages.map(page => {
            if (page.featured_image) {
                page.featured_image = normalizeUrl(page.featured_image);
            }
            if (page.content) {
                page.content = normalizeContentImages(page.content);
                // Sanitize legacy &nbsp; entities from database records
                page.content = deepSanitizeContent(page.content);
            }
            // Expose is_contact_form_active at top level for contact pages
            if (page.content && typeof page.content === 'object') {
                page.is_contact_form_active = page.content.is_contact_form_active !== false;
            }
            return page;
        });

        res.json(normalizedPages);
    } catch (error) {
        console.error('[PUBLIC API ERROR] Get pages:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// GET /pages/:slug — Get a single published page by slug
// =============================================================
router.get('/pages/:slug', async (req, res) => {
    try {
        const tenantId = req.api_tenant_id;
        const { slug } = req.params;

        const [rows] = await db.execute(
            "SELECT * FROM pages WHERE tenant_id = ? AND slug = ? AND status = 'published' LIMIT 1",
            [tenantId, slug]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Page not found.' });
        }

        const page = rows[0];
        if (page.featured_image) {
            page.featured_image = normalizeUrl(page.featured_image);
        }
        if (page.content) {
            page.content = normalizeContentImages(page.content);
            // Sanitize legacy &nbsp; entities from database records
            page.content = deepSanitizeContent(page.content);
        }
        // Expose is_contact_form_active at top level for contact pages
        if (page.content && typeof page.content === 'object') {
            page.is_contact_form_active = page.content.is_contact_form_active !== false;
        }

        res.json(page);
    } catch (error) {
        console.error('[PUBLIC API ERROR] Get single page:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// GET /navigation — Pages visible in the navbar
// =============================================================
// Returns title and slug for pages where is_in_navbar = 1 and
// status = 'published'. Used to render the site's header nav.
// =============================================================

router.get('/navigation', async (req, res) => {
    try {
        const tenantId = req.api_tenant_id;
        const [navItems] = await db.execute(
            `SELECT title, slug
             FROM pages
             WHERE tenant_id = ? AND is_in_navbar = 1 AND status = 'published'
             ORDER BY priority ASC`,
            [tenantId]
        );


        res.json(navItems);
    } catch (error) {
        console.error('[PUBLIC API ERROR] Get navigation:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// GET /settings — Site identity, branding & footer configuration
// =============================================================
router.get('/settings', async (req, res) => {
    try {
        const tenantId = req.api_tenant_id;
        const [settingsRows] = await db.execute(
            "SELECT site_name as title, tagline, logo_url, global_options FROM settings WHERE tenant_id = ? LIMIT 1",
            [tenantId]
        );

        if (settingsRows.length === 0) {
            return res.status(404).json({ error: 'Settings not found for this tenant' });
        }

        const row = settingsRows[0];
        let globalOptions = {};
        if (row.global_options) {
            try { 
                globalOptions = typeof row.global_options === 'string' ? JSON.parse(row.global_options) : row.global_options; 
            } catch (e) {
                console.error('[PUBLIC API] Failed to parse global_options:', e);
            }
        }

        const settings = {
            // Header Branding
            site_name: row.title,
            title: row.title,
            tagline: row.tagline,
            logo_url: row.logo_url ? normalizeUrl(row.logo_url) : null,
            // Frontend & General Settings
            frontend_url: globalOptions.frontend_url || '',
            support_email: globalOptions.support_email || '',
            // Footer
            copyright_text: globalOptions.footer_config?.copyright_text || '',
            footer_text: globalOptions.footer_config?.footer_text || '',
            social_links: globalOptions.footer_config?.social_links || [],
            footer_nav_1: globalOptions.footer_config?.footer_nav_1 || [],
            footer_nav_2: globalOptions.footer_config?.footer_nav_2 || [],
            footer_contacts: globalOptions.footer_config?.footer_contacts || [],
            google_maps_url: globalOptions.footer_config?.google_maps_url || null,
            address: globalOptions.footer_config?.address || '',
            alamat: globalOptions.footer_config?.address || ''
        };

        res.json(settings);
    } catch (error) {
        console.error('[PUBLIC API ERROR] Get settings:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// GET /post-categories — Published categories
// =============================================================
router.get('/post-categories', async (req, res) => {
    try {
        const tenantId = req.api_tenant_id;
        const [categories] = await db.execute(
            "SELECT * FROM post_categories WHERE tenant_id = ? ORDER BY name ASC", 
            [tenantId]
        );
        res.json(categories);
    } catch (error) {
        console.error('[PUBLIC API ERROR] Get categories:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
