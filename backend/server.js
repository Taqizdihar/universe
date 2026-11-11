const express = require('express');
const archiver = require('archiver');
const rateLimit = require('express-rate-limit');

const cors = require('cors');
require('dotenv').config();
const { sendInquiryNotification, sendSuperAdminVerificationCode, sendPasswordResetEmail } = require('./services/emailService');
const { SUPER_ADMIN_EMAIL } = require('./config/superAdmin');
const { normalizeEmail, hasGlobalSuperAdminRole, credentialVersion, verificationCodeHash, constantTimeHexEqual } = require('./utils/superAdminAuth');
const { parseTenantId, can, resolveTenantContext } = require('./security/tenantAccess');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 bytes.');
}
const db = require('./server/lib/db');
const { currentVersion, bumpVersion, bumpVersionIfAvailable } = require('./security/authVersion');
const { logActivity } = require('./services/loggerService');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { deepSanitizeContent } = require('./utils/sanitizeHtml');
const { sanitizePublicJson } = require('./utils/publicContent');
// Cloudinary removed in favor of Kroombox CDN

const app = express();

// Report stable diagnostics without serializing SQL, credentials, or upstream responses.
const logOperationalError = (scope, error) => {
    console.error(scope, { code: error?.code || error?.name || 'UNKNOWN', status: error?.response?.status || null });
};

// Trust one reverse-proxy hop; never trust an arbitrary X-Forwarded-For chain.
app.set('trust proxy', 1);

const allowedOrigins = new Set();
for (const value of [process.env.FRONTEND_URL, ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',')]) {
  if (!value?.trim()) continue;
  try { allowedOrigins.add(new URL(value.trim()).origin); } catch { throw new Error('Invalid CORS frontend origin configuration.'); }
}
if (!process.env.FRONTEND_URL && process.env.NODE_ENV !== 'production') {
  allowedOrigins.add('http://localhost:3000');
  allowedOrigins.add('http://localhost:5173');
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isPublic = /^\/api\/(?:public\/|v1\/public\/|v1\/health(?:\/|$)|v1\/inquiries(?:\/|$))/.test(req.path);
  if (isPublic) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (origin) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, x-api-key, x-active-tenant');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

  // Immediate response for Preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

app.use(express.json());
const { createPasswordRecoveryRouter } = require('./server/routes/passwordRecovery');
app.use('/api/auth', createPasswordRecoveryRouter({ db, bcrypt, sendPasswordResetEmail, bumpVersion, superAdminEmail: SUPER_ADMIN_EMAIL }));

// Sanitize public JSON at the response boundary, including legacy stored HTML.
app.use(['/api/public', '/api/v1/public'], sanitizePublicJson);

// Verbose Request Logging
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.path}`);
    next();
});

// Kroombox CDN Service & Multer Memory Storage Configuration
const cdnService = require('./services/cdnService');
const { buildCdnPath } = require('./utils/pathHelper');
const upload = multer({ storage: multer.memoryStorage() });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ========================================================
// HEALTH CHECK ENDPOINT (Public — no auth required)
// ========================================================
const healthRoutes = require('./server/routes/health');
app.use('/api/v1/health', healthRoutes);

// =============================================================
// ★ PUBLIC PREVIEW ROUTE — MUST STAY BEFORE authenticateToken ★
// Express runs app.use('/api', authMiddleware) on ALL /api/*
// requests. The only escape is to register this handler BEFORE
// that middleware is ever loaded into the stack.
// =============================================================
app.get(['/api/public/site/:subdomain', '/api/public/site/:subdomain/:slug'], async (req, res) => {
    const { subdomain } = req.params;
    const cleanSlug = (req.params.slug || 'home').replace(/^\/+/, '');
    if (!/^[a-z0-9_-]{1,100}$/i.test(subdomain) || !/^[a-z0-9_-]{1,255}$/i.test(cleanSlug)) {
        return res.status(404).json({ error: 'Not found' });
    }

    console.log(`[PREVIEW] Domain lookup: ${subdomain}, View slug: ${cleanSlug}`);

    try {
        // 1. Resolve Tenant first
        const [tenants] = await db.execute("SELECT id FROM tenants WHERE subdomain = ? AND status = 'active'", [subdomain]);
        if (tenants.length === 0) return res.status(404).json({ error: 'Tenant tidak ditemukan.' });
        const tenantId = tenants[0].id;

        // 2. Resolve Page or Post for that specific tenant
        // Page lookup
        const [pages] = await db.execute(
            `SELECT p.*, s.site_name, s.tagline, s.global_options, s.logo_url
             FROM pages p
             LEFT JOIN settings s ON p.tenant_id = s.tenant_id
             WHERE p.slug = ? AND p.tenant_id = ? AND p.status = 'published'
             LIMIT 1`,
            [cleanSlug, tenantId]
        );

        if (pages.length > 0) {
            const row = pages[0];
            const [navPages] = await db.execute(
                "SELECT title, slug FROM pages WHERE tenant_id = ? AND status = 'published' ORDER BY id ASC",
                [tenantId]
            );

            if (row.content && typeof row.content === 'string') {
                try { row.content = JSON.parse(row.content); } catch(e) {}
            }
            // Sanitize legacy &nbsp; entities from database records
            if (row.content) row.content = deepSanitizeContent(row.content);
            let globalOptions = {};
            if (row.global_options) {
                try { globalOptions = typeof row.global_options === 'string' ? JSON.parse(row.global_options) : row.global_options; } catch(e) {}
            }

            return res.json({
                type: 'page',
                page: { id: row.id, title: row.title, slug: row.slug, page_type: row.page_type, content: row.content, status: row.status, tenant_id: tenantId },
                settings: { site_name: row.site_name || 'Uni-Inside', tagline: row.tagline || '', logo_url: row.logo_url || null, global_options: globalOptions },
                navPages
            });
        }

        // Post lookup (if no page matches)
        const [posts] = await db.execute(
            `SELECT p.*, pc.name AS category_name, pc.slug AS category_slug,
                    s.site_name, s.tagline, s.global_options, s.logo_url
             FROM posts p
             LEFT JOIN post_categories pc ON p.category_id = pc.id AND pc.tenant_id = p.tenant_id
             LEFT JOIN settings s ON p.tenant_id = s.tenant_id
             WHERE p.slug = ? AND p.tenant_id = ? AND p.status = 'published'
             LIMIT 1`,
            [cleanSlug, tenantId]
        );

        if (posts.length > 0) {
            const row = posts[0];
            const [navPages] = await db.execute(
                "SELECT title, slug FROM pages WHERE tenant_id = ? AND status = 'published' ORDER BY id ASC",
                [tenantId]
            );

            let globalOptions = {};
            if (row.global_options) {
                try { globalOptions = typeof row.global_options === 'string' ? JSON.parse(row.global_options) : row.global_options; } catch(e) {}
            }
            if (row.content && typeof row.content === 'string') {
                try { row.content = JSON.parse(row.content); } catch(e) {}
            }
            // Sanitize legacy &nbsp; entities from database records
            if (row.content) row.content = deepSanitizeContent(row.content);

            return res.json({
                type: 'post',
                page: { id: row.id, title: row.title, slug: row.slug, category: row.category, category_name: row.category_name, category_slug: row.category_slug, template_type: row.template_type, category_id: row.category_id, content: row.content, created_at: row.created_at, tenant_id: tenantId },
                settings: { site_name: row.site_name || 'Uni-Inside', tagline: row.tagline || '', logo_url: row.logo_url || null, global_options: globalOptions },
                navPages
            });
        }

        res.status(404).json({ error: `Not found: ${cleanSlug} for site ${subdomain}` });
    } catch (error) {
        logOperationalError('[PREVIEW ERROR] Database failure during site resolution:', error);
        res.status(500).json({ error: 'Data resolution failure' });
    }
});

app.get('/api/public/updates', async (req, res) => {
    try {
        // Task 1: Identify and Sanitize Parameters
        const tenantIdVal = req.query.tenant_id;
        let safeTenantId = parseInt(tenantIdVal, 10);
        if (isNaN(safeTenantId)) {
            safeTenantId = null;
        }

        const limitVal = req.query.limit;
        let safeLimit = Number(limitVal);
        if (!Number.isSafeInteger(safeLimit) || safeLimit <= 0) safeLimit = 10;
        safeLimit = Math.min(safeLimit, 100);

        // Task 2: Defensive Query Construction
        let query = 'SELECT * FROM update_history';
        const params = [];

        query += ` ORDER BY update_date DESC LIMIT ${safeLimit}`;

        const [updates] = await db.execute(query, params);
        
        // Task 3: Response Integrity (Ensure [] if empty)
        if (!updates || updates.length === 0) {
            return res.json([]);
        }

        // Fetch images for each update
        const updatesWithImages = await Promise.all(updates.map(async (update) => {
            // DEFENSIVE FIX: Ensure update_id is never undefined
            // We check both 'id' and 'update_id' column possibilities
            const currentId = update.id || update.id_update || 0;
            
            const [images] = await db.execute(
                'SELECT image_url FROM update_images WHERE update_id = ?', 
                [currentId || null]
            );

            return {
                id: currentId,
                title: update.update_title || '',
                description: update.update_description || '',
                version: update.update_version || '',
                created_at: update.update_date || null,
                images: Array.isArray(images) ? images.map(img => img.image_url) : []
            };
        }));

        res.json(updatesWithImages);
    } catch (error) {
        logOperationalError('[API ERROR] Get public updates:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


app.get('/api/v1/public/broadcast', async (req, res) => {
    try {
        const [settings] = await db.execute("SELECT setting_value FROM global_settings WHERE setting_key = 'broadcast'");
        if (settings.length > 0) {
            res.json(JSON.parse(settings[0].setting_value));
        } else {
            res.json(null);
        }
    } catch (error) {
        res.json(null);
    }
});

app.get('/api/v1/public/faqs', async (req, res) => {
    try {
        const [faqs] = await db.execute('SELECT * FROM global_faqs ORDER BY priority ASC, created_at DESC');
        res.json(faqs);
    } catch (error) {
        logOperationalError('[API ERROR] Get public faqs:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Auth Middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = typeof authHeader === 'string' && /^Bearer [^\s]+$/.test(authHeader) ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    let user;
    try {
        user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    try {
        const override = req.headers['x-active-tenant'];
        const hasOverride = override !== undefined && override !== '';
        const requestedTenantId = hasOverride ? parseTenantId(override) : (user.tenant_id == null ? null : parseTenantId(user.tenant_id));
        if ((hasOverride || user.tenant_id != null) && !requestedTenantId) {
            return res.status(400).json({ error: 'Invalid tenant ID' });
        }
        if (!parseTenantId(user.userId)) return res.status(401).json({ error: 'Unauthorized' });
        
        const [userCheck] = await db.execute('SELECT name, email, password_hash FROM users WHERE id = ?', [user.userId]);
        if (userCheck.length === 0) return res.status(401).json({ error: 'Unauthorized' });
        user.name = userCheck[0].name;
        user.email = userCheck[0].email;
        const authVersion = await currentVersion(db, user.userId);
        if ((user.auth_version || 0) !== authVersion) return res.status(401).json({ error: 'Sesi kedaluwarsa. Silakan masuk kembali.' });
        user.auth_version = authVersion;
        user.isSuperAdmin = false;
        const isSuperAdmin = await hasGlobalSuperAdminRole(db, user.userId, user.email);
        
        if (isSuperAdmin) {
            if (!process.env.JWT_SECRET || !constantTimeHexEqual(user.credential_version, credentialVersion(userCheck[0].password_hash, JWT_SECRET))) {
                return res.status(401).json({ error: 'Sesi Super Admin kedaluwarsa. Silakan masuk kembali.' });
            }
            user.isSuperAdmin = true;
        }
        const tenantContext = requestedTenantId
            ? await resolveTenantContext(db, requestedTenantId, user.userId, isSuperAdmin)
            : null;
        if (hasOverride && !tenantContext) return res.status(403).json({ error: 'Workspace access denied.' });
        user.role = isSuperAdmin ? 'super_admin' : (tenantContext?.role || 'guest');
        user.tenant_id = tenantContext?.tenantId || null;
        req.user = user;
        req.tenantContext = tenantContext;
        next();
    } catch (dbError) {
        logOperationalError('[AUTH] Dynamic role resolution failed:', dbError);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Super Admin Middleware: role and fixed mailbox are verified against the DB on every request.
const verifySuperAdmin = (req, res, next) => {
    if (req.user && req.user.isSuperAdmin === true) {
        return next();
    }
    return res.status(403).json({ error: 'Access Denied: Super Admin privileges required.' });
};

// =============================================================
// ★ SUPER ADMIN PRIVILEGED ROUTES ★
// =============================================================

// --- Infrastructure Management ---
app.get('/api/v1/superadmin/infrastructure/stats', authenticateToken, verifySuperAdmin, async (req, res) => {
    try {
        // 1. DB Connection Check
        let dbStatus = 'disconnected';
        try {
            await db.execute('SELECT 1');
            dbStatus = 'connected';
        } catch (e) {
            logOperationalError('DB Health Check Failed:', e);
        }

        // 2. Global Row Counts
        const [postsCount] = await db.execute('SELECT COUNT(*) as count FROM posts');
        const [pagesCount] = await db.execute('SELECT COUNT(*) as count FROM pages');
        const [mediaCount] = await db.execute('SELECT COUNT(*) as count FROM media');

        // 3. Storage Usage (Total and Top 5)
        // Assume file_size is stored in bytes. Convert to MB.
        let totalUsedMB = 0;
        try {
            const [totalStorageQuery] = await db.execute('SELECT SUM(file_size) as total_used FROM media');
            const totalUsedBytes = totalStorageQuery[0].total_used || 0;
            totalUsedMB = Math.round(totalUsedBytes / (1024 * 1024));
        } catch(err) {
            console.warn('[SUPER ADMIN] Storage total query failed:', err.code || 'UNKNOWN');
        }

        let formattedTopConsumers = [];
        try {
            const [topConsumers] = await db.execute(`
                SELECT t.id as tenant_id, t.subdomain, SUM(m.file_size) as total_size_bytes
                FROM tenants t
                LEFT JOIN media m ON t.id = m.tenant_id
                GROUP BY t.id, t.subdomain
                ORDER BY total_size_bytes DESC
                LIMIT 5
            `);
            formattedTopConsumers = topConsumers.map(c => ({
                tenant_id: c.tenant_id,
                subdomain: c.subdomain,
                total_size_mb: Math.round((c.total_size_bytes || 0) / (1024 * 1024))
            }));
        } catch(err) {
            console.warn('[SUPER ADMIN] Top consumers query failed:', err.code || 'UNKNOWN');
        }

        res.json({
            dbStatus,
            rowCounts: {
                posts: postsCount[0].count,
                pages: pagesCount[0].count,
                media: mediaCount[0].count
            },
            storage: {
                total_used_mb: totalUsedMB,
                quota_mb: 25600,
                top_consumers: formattedTopConsumers
            }
        });
    } catch (error) {
        logOperationalError('[SUPER ADMIN] Fetch infra stats error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// --- FAQ Management ---
app.get('/api/v1/superadmin/faqs', authenticateToken, verifySuperAdmin, async (req, res) => {
    try {
        const [faqs] = await db.execute('SELECT * FROM global_faqs ORDER BY priority ASC, created_at DESC');
        res.json(faqs);
    } catch (error) {
        logOperationalError('[SUPER ADMIN] Fetch faqs error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/v1/superadmin/faqs', authenticateToken, verifySuperAdmin, async (req, res) => {
    try {
        const { question, answer, category, priority } = req.body;
        if (!question || !answer) return res.status(400).json({ error: 'Question and answer are required' });
        
        await db.execute(
            'INSERT INTO global_faqs (question, answer, category, priority) VALUES (?, ?, ?, ?)',
            [question, answer, category || 'Umum', priority || 0]
        );
        res.status(201).json({ success: true });
    } catch (error) {
        logOperationalError('[SUPER ADMIN] Add faq error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.put('/api/v1/superadmin/faqs/:id', authenticateToken, verifySuperAdmin, async (req, res) => {
    try {
        const { question, answer, category, priority } = req.body;
        await db.execute(
            'UPDATE global_faqs SET question = ?, answer = ?, category = ?, priority = ? WHERE id = ?',
            [question, answer, category, priority, req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        logOperationalError('[SUPER ADMIN] Update faq error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.delete('/api/v1/superadmin/faqs/:id', authenticateToken, verifySuperAdmin, async (req, res) => {
    try {
        await db.execute('DELETE FROM global_faqs WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        logOperationalError('[SUPER ADMIN] Delete faq error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


app.get('/api/v1/superadmin/tenants', authenticateToken, verifySuperAdmin, async (req, res) => {
    try {
        const query = `
            SELECT t.id as tenant_id, t.subdomain, t.created_at, IFNULL(t.status, 'active') as status,
                   u.id as admin_id, u.name as admin_name, u.email as admin_email
            FROM tenants t
            LEFT JOIN tenant_users tu ON t.id = tu.tenant_id AND tu.role = 'admin' AND tu.status = 'active'
            LEFT JOIN users u ON tu.user_id = u.id
            ORDER BY t.created_at DESC
        `;
        const [tenants] = await db.execute(query);
        res.json(tenants);
    } catch (error) {
        logOperationalError('[SUPER ADMIN] Fetch tenants error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Emergency reset for the admin shown on a tenant's management row.
app.put('/api/v1/superadmin/tenants/:tenantId/admins/:adminId/password', authenticateToken, verifySuperAdmin, async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const adminId = Number(req.params.adminId);
    const { newPassword, confirmPassword } = req.body || {};
    if (!Number.isSafeInteger(tenantId) || tenantId < 1 || !Number.isSafeInteger(adminId) || adminId < 1) {
        return res.status(400).json({ error: 'ID tenant atau admin tidak valid.' });
    }
    if (adminId === req.user.userId) {
        return res.status(400).json({ error: 'Gunakan profil untuk mengubah password akun Anda sendiri.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128 || !newPassword.trim()) {
        return res.status(400).json({ error: 'Password baru harus berisi 12–128 karakter.' });
    }
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'Konfirmasi password tidak cocok.' });
    }

    let connection;
    try {
        const [admins] = await db.execute(
            `SELECT u.id, u.email FROM tenants t
             JOIN tenant_users tu ON tu.tenant_id = t.id AND tu.role = 'admin' AND tu.status = 'active'
             JOIN users u ON u.id = tu.user_id
             WHERE t.id = ? AND u.id = ? LIMIT 1`,
            [tenantId, adminId]
        );
        if (admins.length === 0) return res.status(404).json({ error: 'Admin aktif tidak ditemukan pada tenant ini.' });
        if (await hasGlobalSuperAdminRole(db, adminId, admins[0].email)) {
            return res.status(403).json({ error: 'Password Super Admin hanya dapat dipulihkan melalui verifikasi email.' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [locked] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [adminId]);
        if (!locked.length) { await connection.rollback(); return res.status(404).json({ error: 'Admin tidak ditemukan.' }); }
        await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, adminId]);
        await bumpVersionIfAvailable(connection, adminId);
        await connection.commit();
        logActivity(tenantId, req.user.userId, req.user.name || req.user.email, 'super_admin', `Emergency password reset for admin ${adminId}`, 'success');
        res.json({ message: 'Password admin tenant berhasil direset.' });
    } catch (error) {
        if (connection) await connection.rollback();
        logOperationalError('[SUPER ADMIN] Emergency password reset error:', error);
        res.status(500).json({ error: 'Gagal mereset password admin tenant.' });
    } finally {
        if (connection) connection.release();
    }
});

app.patch('/api/v1/superadmin/tenants/:id/status', authenticateToken, verifySuperAdmin, async (req, res) => {
    try {
        const tenantId = req.params.id;
        const { status } = req.body;
        if (!['active', 'suspended'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        await db.execute('UPDATE tenants SET status = ? WHERE id = ?', [status, tenantId]);
        res.json({ success: true, status });
    } catch (error) {
        logOperationalError('[SUPER ADMIN] Update tenant status error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// Impersonate V2 — Shadow Mode (Super Admin keeps own identity)
// =============================================================
// Instead of generating a new JWT as the target user (which strips
// the super_admin role and triggers eviction guards), this endpoint
// returns the tenant context so the frontend can set active_tenant_id
// while keeping the super admin's own JWT intact.
// =============================================================
app.post('/api/v1/superadmin/impersonate/:tenantId', authenticateToken, verifySuperAdmin, async (req, res) => {
    try {
        const tenantId = parseTenantId(req.params.tenantId);
        if (!tenantId) return res.status(400).json({ error: 'Invalid tenant ID' });

        // Verify the tenant exists
        const [tenants] = await db.execute('SELECT id, subdomain, name FROM tenants WHERE id = ?', [tenantId]);
        if (tenants.length === 0) return res.status(404).json({ error: 'Tenant not found' });
        const tenant = tenants[0];

        // Fetch site_name from settings
        let site_name = tenant.name || 'My Site';
        const [settings] = await db.execute('SELECT site_name FROM settings WHERE tenant_id = ?', [tenantId]);
        if (settings && settings.length > 0) {
            site_name = settings[0].site_name || site_name;
        }

        // Fetch admin info for context
        const [adminRows] = await db.execute(
            `SELECT u.name, u.email FROM tenant_users tu JOIN users u ON tu.user_id = u.id WHERE tu.tenant_id = ? AND tu.role = 'admin' LIMIT 1`,
            [tenantId]
        );

        const recorded = await logActivity(tenantId, req.user.userId, req.user.name || req.user.email, 'super_admin', 'Shadow workspace selected', 'attempt');
        if (!recorded) return res.status(503).json({ error: 'Audit service unavailable.' });

        console.log(`[SUPER ADMIN] Impersonating tenant ${tenantId} (${tenant.subdomain}) in shadow mode`);

        res.json({
            tenant_id: tenantId,
            subdomain: tenant.subdomain,
            site_name,
            admin_name: adminRows.length > 0 ? adminRows[0].name : null,
            admin_email: adminRows.length > 0 ? adminRows[0].email : null
        });
    } catch (error) {
        logOperationalError('[SUPER ADMIN] Impersonate error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/super-admin/stats', authenticateToken, verifySuperAdmin, async (req, res) => {
    try {
        const [userCount] = await db.execute('SELECT COUNT(*) as total FROM users');
        const [tenantCount] = await db.execute('SELECT COUNT(*) as total FROM tenants');
        res.json({
            totalUsers: userCount[0].total,
            totalTenants: tenantCount[0].total
        });
    } catch (error) {
        logOperationalError('[SUPER ADMIN ERROR] Stats fetch failed:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Update History Management ---
app.get('/api/v1/superadmin/updates', authenticateToken, verifySuperAdmin, async (req, res) => {
    try {
        const [updates] = await db.execute('SELECT * FROM update_history ORDER BY update_date DESC');
        
        const updatesWithImages = await Promise.all(updates.map(async (update) => {
            const currentId = update.id || update.id_update || 0;
            const [images] = await db.execute('SELECT id, image_url FROM update_images WHERE update_id = ?', [currentId]);
            return {
                id: currentId,
                title: update.update_title,
                description: update.update_description,
                version: update.update_version,
                date: update.update_date,
                images: images
            };
        }));
        res.json(updatesWithImages);
    } catch (error) {
        logOperationalError('[SUPER ADMIN] Fetch updates error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/v1/superadmin/updates', authenticateToken, verifySuperAdmin, async (req, res) => {
    const { title, description, version, date, images } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.execute(
            'INSERT INTO update_history (update_title, update_description, update_version, update_date) VALUES (?, ?, ?, ?)',
            [title, description, version, date || new Date()]
        );
        const updateId = result.insertId;

        if (images && images.length > 0) {
            const placeholders = images.map(() => '(?, ?)').join(', ');
            const params = [];
            images.forEach(url => params.push(updateId, url));
            await connection.execute(`INSERT INTO update_images (update_id, image_url) VALUES ${placeholders}`, params);
        }
        await connection.commit();
        res.json({ success: true, id: updateId });
    } catch (error) {
        await connection.rollback();
        logOperationalError('[SUPER ADMIN] Add update error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        connection.release();
    }
});

app.put('/api/v1/superadmin/updates/:id', authenticateToken, verifySuperAdmin, async (req, res) => {
    const { title, description, version, date, images } = req.body;
    const updateId = req.params.id;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute(
            'UPDATE update_history SET update_title = ?, update_description = ?, update_version = ?, update_date = ? WHERE id = ? OR id_update = ?',
            [title, description, version, date, updateId, updateId]
        );
        
        await connection.execute('DELETE FROM update_images WHERE update_id = ?', [updateId]);
        if (images && images.length > 0) {
            const placeholders = images.map(() => '(?, ?)').join(', ');
            const params = [];
            images.forEach(url => params.push(updateId, url));
            await connection.execute(`INSERT INTO update_images (update_id, image_url) VALUES ${placeholders}`, params);
        }
        await connection.commit();
        res.json({ success: true });
    } catch (error) {
        await connection.rollback();
        logOperationalError('[SUPER ADMIN] Edit update error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        connection.release();
    }
});

app.delete('/api/v1/superadmin/updates/:id', authenticateToken, verifySuperAdmin, async (req, res) => {
    try {
        await db.execute('DELETE FROM update_history WHERE id = ? OR id_update = ?', [req.params.id, req.params.id]);
        res.json({ success: true });
    } catch (error) {
        logOperationalError('[SUPER ADMIN] Delete update error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Broadcast Management ---
app.post('/api/v1/superadmin/broadcast', authenticateToken, verifySuperAdmin, async (req, res) => {
    try {
        const { message, urgency_level } = req.body;
        const type = urgency_level || 'system_update';
        
        await db.execute(
            `INSERT INTO notifications (user_id, tenant_id, type, message, is_read, created_at)
             SELECT u.id, tu.tenant_id, ?, ?, 0, NOW() 
             FROM users u 
             JOIN tenant_users tu ON u.id = tu.user_id 
             WHERE tu.role != 'super_admin' AND tu.status = 'active'`,
            [type, message]
        );
        
        res.json({ success: true });
    } catch (error) {
        logOperationalError('[SUPER ADMIN] Broadcast error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Cloudinary → Kroombox Migration (One-Time, Super Admin Only) ---
let migrationRunning = false;
app.get('/api/admin/start-migration', authenticateToken, verifySuperAdmin, async (req, res) => {
    if (migrationRunning) {
        return res.status(409).json({ error: 'Migration is already running. Please wait for it to finish.' });
    }

    migrationRunning = true;
    console.log('[MIGRATION] ▶ Super Admin triggered Cloudinary → Kroombox migration');

    try {
        const { migrateCloudinaryToKroombox } = require('./scripts/migrateCloudinary');
        const result = await migrateCloudinaryToKroombox();

        res.json({
            success: true,
            message: 'Migration completed',
            ...result,
        });
    } catch (error) {
        logOperationalError('[MIGRATION] ❌ Fatal error:', error);
        res.status(500).json({
            success: false,
            error: 'Migration failed',
        });
    } finally {
        migrationRunning = false;
    }
});


const superAdminCodeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Terlalu banyak permintaan. Coba lagi nanti.' }
});
const superAdminCompleteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Terlalu banyak percobaan. Coba lagi nanti.' }
});
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Terlalu banyak percobaan login. Coba lagi nanti.' }
});
const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Terlalu banyak pendaftaran. Coba lagi nanti.' }
});

// Both initial enrollment and account recovery require possession of the
// fixed mailbox. The bootstrap path never trusts a user ID or a JWT role.
app.post('/api/auth/super-admin/request-code', superAdminCodeLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const sentMessage = { message: 'Jika alamat terdaftar sebagai Super Admin, kode verifikasi akan dikirim.' };
    if (email !== SUPER_ADMIN_EMAIL) return res.json(sentMessage);
    if (!process.env.JWT_SECRET) return res.status(503).json({ error: 'Konfigurasi keamanan server belum lengkap.' });

    try {
        const [roles] = await db.execute(
            "SELECT u.email FROM user_global_roles ugr JOIN users u ON u.id = ugr.user_id WHERE ugr.role = 'super_admin' LIMIT 2"
        );
        if (roles.length > 1 || (roles.length === 1 && normalizeEmail(roles[0].email) !== SUPER_ADMIN_EMAIL)) {
            return res.json(sentMessage);
        }
        const [recent] = await db.execute(
            'SELECT id FROM super_admin_verifications WHERE email = ? AND created_at > NOW() - INTERVAL 60 SECOND ORDER BY id DESC LIMIT 1',
            [email]
        );
        if (recent.length > 0) return res.json(sentMessage);

        const purpose = roles.length === 0 ? 'bootstrap' : 'recovery';
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const codeHash = verificationCodeHash(email, purpose, code, JWT_SECRET);
        const [challenge] = await db.execute(
            'INSERT INTO super_admin_verifications (email, code_hash, purpose, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))',
            [email, codeHash, purpose]
        );
        if (!await sendSuperAdminVerificationCode(email, code, purpose)) {
            await db.execute('DELETE FROM super_admin_verifications WHERE id = ?', [challenge.insertId]);
            return res.status(503).json({ error: 'Email verifikasi belum dapat dikirim. Periksa konfigurasi SMTP.' });
        }
        return res.json(sentMessage);
    } catch (error) {
        logOperationalError('[SUPER ADMIN] Verification request failed:', error);
        return res.status(500).json({ error: 'Gagal meminta kode verifikasi.' });
    }
});

app.post('/api/auth/super-admin/complete', superAdminCompleteLimiter, async (req, res) => {
    const { code, name, newPassword, confirmPassword } = req.body || {};
    const email = normalizeEmail(req.body?.email);
    if (email !== SUPER_ADMIN_EMAIL || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: 'Kode verifikasi tidak valid.' });
    }
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 255) {
        return res.status(400).json({ error: 'Nama harus berisi 2–255 karakter.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128 || !newPassword.trim()) {
        return res.status(400).json({ error: 'Password baru harus berisi 12–128 karakter.' });
    }
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'Konfirmasi password tidak cocok.' });
    }
    if (!process.env.JWT_SECRET) return res.status(503).json({ error: 'Konfigurasi keamanan server belum lengkap.' });

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [challenges] = await connection.execute(
            'SELECT id, code_hash, purpose, attempt_count, consumed_at, expires_at > NOW() AS is_valid FROM super_admin_verifications WHERE email = ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
            [email]
        );
        const challenge = challenges[0];
        if (!challenge || challenge.consumed_at || !challenge.is_valid || challenge.attempt_count >= 5) {
            await connection.rollback();
            return res.status(400).json({ error: 'Kode kedaluwarsa atau tidak valid. Minta kode baru.' });
        }
        const expectedHash = verificationCodeHash(email, challenge.purpose, code, JWT_SECRET);
        if (!constantTimeHexEqual(challenge.code_hash, expectedHash)) {
            await connection.execute('UPDATE super_admin_verifications SET attempt_count = attempt_count + 1 WHERE id = ?', [challenge.id]);
            await connection.commit();
            return res.status(400).json({ error: 'Kode verifikasi tidak valid.' });
        }

        const [globalAdmins] = await connection.execute(
            "SELECT ugr.user_id, u.email FROM user_global_roles ugr JOIN users u ON u.id = ugr.user_id WHERE ugr.role = 'super_admin' FOR UPDATE"
        );
        const passwordHash = await bcrypt.hash(newPassword, 12);
        if (challenge.purpose === 'bootstrap') {
            if (globalAdmins.length !== 0) {
                await connection.rollback();
                return res.status(409).json({ error: 'Akun Super Admin sudah terdaftar.' });
            }
            const [existingUsers] = await connection.execute('SELECT id FROM users WHERE email = ? FOR UPDATE', [email]);
            let userId;
            if (existingUsers.length > 0) {
                userId = existingUsers[0].id;
                await connection.execute('UPDATE users SET name = ?, password_hash = ? WHERE id = ?', [name.trim(), passwordHash, userId]);
            } else {
                const [inserted] = await connection.execute(
                    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
                    [name.trim(), email, passwordHash]
                );
                userId = inserted.insertId;
            }
            await connection.execute("INSERT INTO user_global_roles (user_id, role) VALUES (?, 'super_admin')", [userId]);
        } else if (challenge.purpose === 'recovery' && globalAdmins.length === 1 && normalizeEmail(globalAdmins[0].email) === email) {
            await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, globalAdmins[0].user_id]);
        } else {
            await connection.rollback();
            return res.status(409).json({ error: 'Status akun Super Admin telah berubah. Minta kode baru.' });
        }
        await connection.execute('UPDATE super_admin_verifications SET consumed_at = NOW() WHERE id = ?', [challenge.id]);
        await connection.commit();
        return res.json({ message: 'Akun Super Admin siap. Silakan login dengan email dan password baru.' });
    } catch (error) {
        if (connection) await connection.rollback();
        logOperationalError('[SUPER ADMIN] Verification completion failed:', error);
        return res.status(500).json({ error: 'Gagal menyelesaikan verifikasi Super Admin.' });
    } finally {
        if (connection) connection.release();
    }
});

app.post('/api/auth/register', registrationLimiter, async (req, res) => {
    let { name, email, password } = req.body;
    try {
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        email = email.trim().toLowerCase();
        if (email === SUPER_ADMIN_EMAIL) {
            return res.status(403).json({ error: 'Alamat ini hanya dapat didaftarkan melalui verifikasi Super Admin.' });
        }
        console.log('[AUTH] Registration requested.');
        const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            console.log('[AUTH] Registration rejected.');
            return res.status(400).json({ error: 'Tidak dapat menyelesaikan pendaftaran.' });
        }
        
        console.log(`[AUTH] Generating placeholder tenant`);
        const subdomain = 'tenant-' + Date.now();
        const [tenant] = await db.execute('INSERT INTO tenants (name, subdomain) VALUES (?, ?)', ['My Site', subdomain]);
        const tenantId = tenant.insertId;

        console.log('[AUTH] Hashing password.');
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('[AUTH] Creating user.');
        const [result] = await db.execute(
            'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
            [name, email, hashedPassword]
        );
        const userId = result.insertId;

        console.log(`[AUTH] Linking user and tenant`);
        await db.execute("INSERT INTO tenant_users (tenant_id, user_id, role, status) VALUES (?, ?, ?, 'active')", [tenantId, userId, 'admin']);

        // Task 1: Auto-generate API Key for new tenant
        const crypto = require('crypto');
        const apiKey = 'uni_' + crypto.randomBytes(24).toString('hex');
        await db.execute('INSERT INTO api_keys (tenant_id, api_key) VALUES (?, ?)', [tenantId, apiKey]);

        // Create default settings registry
        await db.execute(
            'INSERT INTO settings (tenant_id, site_name, tagline, logo_url, global_options) VALUES (?, ?, ?, ?, ?)',
            [tenantId, 'My Site', '', null, JSON.stringify({
                copyright_text: `© ${new Date().getFullYear()} My Site. All rights reserved.`,
                social_links: [],
                frontend_url: ''
            })]
        );

        const token = jwt.sign({ userId, email, tenant_id: tenantId, role: 'admin', auth_version: 0 }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({ 
            message: 'Success', 
            token,
            tenant_id: tenantId,
            user: { id: userId, name, email, tenant_id: tenantId, role: 'admin', site_name: 'My Site' } 
        });
    } catch (error) {
        logOperationalError('DATABASE ERROR:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        let { email, password } = req.body || {};
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        email = email.trim().toLowerCase();
        console.log('[AUTH] Login attempt.');

        // 1. Search for user by email
        const [users] = await db.execute('SELECT id, name, email, profile_picture_url, password_hash FROM users WHERE email = ?', [email]);
        
        if (!users || users.length === 0) {
            console.log('[AUTH] Login failed.');
            return res.status(401).json({ error: 'Kredensial tidak valid' });
        }
        
        const user = users[0];

        // 2. Compare password with hashed version from DB
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            console.log('[AUTH] Login failed.');
            return res.status(401).json({ error: 'Kredensial tidak valid' });
        }
        
        // 3. Retrieve tenant_id and role from tenant_users where status is active
        const [tenantUsers] = await db.execute(
            "SELECT tu.tenant_id, tu.role FROM tenant_users tu JOIN tenants t ON t.id = tu.tenant_id AND t.status = 'active' WHERE tu.user_id = ? AND tu.status = 'active' ORDER BY tu.tenant_id ASC LIMIT 1",
            [user.id]
        );
        let tenant_id = tenantUsers.length > 0 ? tenantUsers[0].tenant_id : null;
        let role = tenantUsers.length > 0 ? tenantUsers[0].role : null;
        if (role === 'super_admin') role = 'guest';

        // 3b. Identify primary tenant (the first admin workspace, i.e. the one created during registration)
        const [adminTenants] = await db.execute(
            "SELECT tu.tenant_id FROM tenant_users tu JOIN tenants t ON t.id = tu.tenant_id AND t.status = 'active' WHERE tu.user_id = ? AND tu.role = 'admin' AND tu.status = 'active' ORDER BY tu.tenant_id ASC LIMIT 1",
            [user.id]
        );
        const primary_tenant_id = adminTenants.length > 0 ? adminTenants[0].tenant_id : tenant_id;

        const isSuperAdmin = await hasGlobalSuperAdminRole(db, user.id, user.email);
        if (isSuperAdmin) {
            if (!process.env.JWT_SECRET) return res.status(503).json({ error: 'Konfigurasi keamanan server belum lengkap.' });
            role = 'super_admin';
        }
        if (!isSuperAdmin && !tenant_id) return res.status(403).json({ error: 'Tidak ada workspace aktif yang dapat diakses.' });

        // 4. Fetch site_name for frontend redirection logic (from PRIMARY tenant)
        let site_name = 'My Site';
        if (primary_tenant_id) {
            const [settings] = await db.execute('SELECT site_name FROM settings WHERE tenant_id = ?', [primary_tenant_id]);
            if (settings && settings.length > 0) {
                site_name = settings[0].site_name;
            }
        }

        const accountVersion = await currentVersion(db, user.id);
        const token = jwt.sign({
            userId: user.id, email: user.email, tenant_id: primary_tenant_id,
            role: role || 'guest',
            auth_version: accountVersion,
            ...(isSuperAdmin ? { credential_version: credentialVersion(user.password_hash, JWT_SECRET) } : {})
        }, JWT_SECRET, { expiresIn: '7d' });
        
        console.log('[AUTH] Login successful.');

        // 5. Response Payload: return token, user object, and top-level tenant_id
        res.json({ 
            token, 
            user: { 
                id: user.id, 
                name: user.name, 
                email: user.email, 
                profile_picture_url: user.profile_picture_url,
                tenant_id: primary_tenant_id, 
                role: role || 'guest',
                site_name 
            },
            tenant_id: primary_tenant_id,
            primary_tenant_id 
        });

    } catch (error) {
        logOperationalError('[AUTH CRITICAL ERROR] Login logic failure:', error);
        // Ensure we send a proper JSON response to prevent CORS issues on client browser
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
});


app.post('/api/auth/setup', authenticateToken, async (req, res) => {
    const { site_name, tagline, subdomain } = req.body;
    const userId = req.user.userId;
    const tenantId = req.user.tenant_id;
    try {
        console.log(`[AUTH] Setting up tenant for User ID: ${userId}, Site Name: ${site_name}`);
        if (!req.tenantContext || !can(req.tenantContext.role, 'settings')) {
            return res.status(403).json({ error: 'Workspace access denied.' });
        }

        // Generate Subdomain automatically from Site Name
        const generatedSubdomain = site_name
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_]+/g, '-')
            .replace(/^-+|-+$/g, '') || `site-${Date.now()}`;

        // Validation for uniqueness (excluding self)
        const [existing] = await db.execute('SELECT * FROM tenants WHERE subdomain = ? AND id != ?', [generatedSubdomain, tenantId]);
        if (existing.length > 0) {
            console.log(`[AUTH] Setup failed: Generated subdomain ${generatedSubdomain} already exists`);
            return res.status(400).json({ error: 'Nama website sudah digunakan. Silakan pilih nama lain.' });
        }

        // a. Update tenant
        await db.execute('UPDATE tenants SET name = ?, subdomain = ? WHERE id = ?', [site_name, generatedSubdomain, tenantId]);

        // b. Update settings
        await db.execute(
            'UPDATE settings SET site_name = ?, tagline = ? WHERE tenant_id = ?',
            [site_name, tagline, tenantId]
        );

        // Sign fresh token
        const token = jwt.sign({ userId, email: req.user.email, tenant_id: tenantId, role: req.user.role, auth_version: req.user.auth_version, ...(req.user.isSuperAdmin ? { credential_version: req.user.credential_version } : {}) }, JWT_SECRET, { expiresIn: '7d' });
        
        console.log(`[AUTH] Setup finalized. Tenant ID: ${tenantId}, Subdomain: ${generatedSubdomain}`);
        res.status(200).json({ 
            message: 'Setup completed', 
            token, 
            user: { id: userId, email: req.user.email, tenant_id: tenantId, role: req.tenantContext.role, site_name: site_name }
        });
    } catch (error) {
        logOperationalError('[AUTH ERROR] Setup Transaction Failure:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// POST /api/auth/switch-workspace — Re-issue JWT for workspace switch
// =============================================================
// This endpoint generates a fresh JWT containing the target tenant_id
// and the user's role for that specific workspace. This prevents the
// system from "remembering" the old role/workspace from the previous
// session and eliminates the login redirect loop.
// =============================================================
app.post('/api/auth/switch-workspace', authenticateToken, async (req, res) => {
    const { tenant_id } = req.body;
    const userId = req.user.userId;
    const targetTenantId = parseTenantId(tenant_id);
    if (!targetTenantId) return res.status(400).json({ error: 'Invalid tenant ID.' });

    try {
        const isSuperAdmin = req.user.isSuperAdmin === true;
        const targetContext = await resolveTenantContext(db, targetTenantId, userId, isSuperAdmin);
        if (!targetContext) return res.status(403).json({ error: 'Anda tidak memiliki akses aktif ke workspace ini.' });
        if (isSuperAdmin) {
            const recorded = await logActivity(targetTenantId, userId, req.user.name || req.user.email, 'super_admin', 'Shadow workspace selected', 'attempt');
            if (!recorded) return res.status(503).json({ error: 'Audit service unavailable.' });
        }
        const targetRole = targetContext.role;

        // 2. Fetch site_name for the target workspace
        let site_name = 'My Site';
        const [settings] = await db.execute('SELECT site_name FROM settings WHERE tenant_id = ?', [targetTenantId]);
        if (settings && settings.length > 0) {
            site_name = settings[0].site_name;
        }

        // 3. Identify the user's primary tenant (where role is admin)
        const [adminTenants] = await db.execute(
            "SELECT tu.tenant_id FROM tenant_users tu JOIN tenants t ON t.id = tu.tenant_id AND t.status = 'active' WHERE tu.user_id = ? AND tu.role = 'admin' AND tu.status = 'active' ORDER BY tu.tenant_id ASC LIMIT 1",
            [userId]
        );
        const primary_tenant_id = adminTenants.length > 0 ? adminTenants[0].tenant_id : targetTenantId;

        // 4. Re-issue JWT with the target tenant context
        const newToken = jwt.sign(
            { userId, email: req.user.email, tenant_id: targetTenantId, role: targetRole, auth_version: req.user.auth_version, ...(isSuperAdmin ? { credential_version: req.user.credential_version } : {}) },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // 5. Fetch user details for frontend context
        const [userRows] = await db.execute('SELECT name, email, profile_picture_url FROM users WHERE id = ?', [userId]);
        const userInfo = userRows.length > 0 ? userRows[0] : {};

        console.log(`[AUTH] Workspace switched: User ${userId} → Tenant ${targetTenantId} (Role: ${targetRole})`);

        res.json({
            token: newToken,
            user: {
                id: userId,
                name: userInfo.name,
                email: userInfo.email,
                profile_picture_url: userInfo.profile_picture_url,
                tenant_id: targetTenantId,
                role: targetRole,
                site_name
            },
            tenant_id: targetTenantId,
            primary_tenant_id,
            workspace_type: targetTenantId === primary_tenant_id ? 'primary' : 'guest'
        });
    } catch (error) {
        logOperationalError('[AUTH ERROR] Switch workspace:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/', (req, res) => res.send('Server is running'));

// =============================================================
// ★ PUBLIC INQUIRY ENDPOINT — Rate-Limited, No Auth Required ★
// =============================================================
// Receives contact form submissions from startup landing pages.
// Protected by rate limiting (5 requests per minute per IP).
// Must be registered BEFORE authenticateToken middleware.
// =============================================================

const inquiryLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5,              // 5 requests per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Terlalu banyak permintaan. Silakan coba lagi dalam 1 menit.' }
});

const { apiAuth } = require('./server/routes/auth');

app.post('/api/v1/inquiries', inquiryLimiter, apiAuth, async (req, res) => {
    try {
        const { name, email, message, subject } = req.body;

        // 1. Validate required fields
        if (!name || !name.trim()) return res.status(400).json({ error: 'Nama wajib diisi.' });
        if (!email || !email.trim()) return res.status(400).json({ error: 'Email wajib diisi.' });
        if (!message || !message.trim()) return res.status(400).json({ error: 'Pesan wajib diisi.' });

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            return res.status(400).json({ error: 'Format email tidak valid.' });
        }

        // 2. Resolve tenant from API Key
        const tenantId = req.api_tenant_id;

        // 3. Insert into contact_inquiries table
        const [result] = await db.execute(
            `INSERT INTO contact_inquiries (tenant_id, name, email, subject, message, status)
             VALUES (?, ?, ?, ?, ?, 'unread')`,
            [tenantId, name.trim(), email.trim(), (subject || '').trim(), message.trim()]
        );

        console.log(`[INQUIRY] ✓ New inquiry #${result.insertId} from ${name.trim()} for tenant ${tenantId}`);

        // 4. Lookup admin email for this tenant
        const [admins] = await db.execute(
            `SELECT u.email, u.recipient_email, u.name as admin_name FROM users u
             JOIN tenant_users tu ON u.id = tu.user_id
             WHERE tu.tenant_id = ? AND tu.role = 'admin' AND tu.status = 'active'
             LIMIT 1`,
            [tenantId]
        );

        // 5. Get site name for email branding
        const [settings] = await db.execute('SELECT site_name FROM settings WHERE tenant_id = ?', [tenantId]);
        const siteName = settings.length > 0 ? settings[0].site_name : 'Website';

        // 6. Send email notification (non-blocking — don't fail the request if email fails)
        if (admins.length > 0) {
            const adminUser = admins[0];
            const targetEmail = adminUser.recipient_email || adminUser.email;
            
            sendInquiryNotification(targetEmail, {
                senderName: name.trim(),
                senderEmail: email.trim(),
                subject: (subject || '').trim(),
                message: message.trim(),
                siteName,
                cmsUrl: process.env.FRONTEND_URL || ''
            }).catch(err => logOperationalError('[INQUIRY] Email notification error:', err));
        }

        res.status(201).json({
            message: 'Pesan berhasil dikirim. Terima kasih!',
            id: result.insertId
        });
    } catch (error) {
        logOperationalError('[INQUIRY ERROR] Submit inquiry:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ========================================================
// PUBLIC V1 API GATEWAY — Content Delivery (Data Routes)
// ========================================================
const dataRoutes = require('./server/routes/data');
app.use('/api/v1/public', dataRoutes);

// Protected routes below
app.use('/api', authenticateToken);

// Every tenant-scoped route receives this ID only after database authorization.
const getTenantId = (req) => req.tenantContext?.tenantId || null;

/**
 * buildMediaUrl — Centralized URL builder for all media types.
 * Maps MIME type to the correct Google Drive endpoint:
 *   - image/*          → /thumbnail?id=&sz=w1200  (high-quality, viewable)
 *   - video/*          → /uc?id=                   (streamable in <video>)
 *   - application/pdf  → /file/d/.../preview        (browser PDF viewer)
 *   - everything else  → bridge/view (download)     (fallback)
 *
 * @param {string} fileId   - The Kroombox CDN fileId (also stored as `filename` in MySQL)
 * @param {string} mimeType - The file's MIME type (e.g. 'image/jpeg', 'video/mp4')
 * @param {string|null} rawUrl - The raw URL returned by the CDN (used to extract driveId)
 * @returns {string} The finalized file_url
 */
const buildMediaUrl = (fileId, mimeType, rawUrl) => {
    // Default fallback — direct CDN view link
    let url = `https://api-cdn.kroombox.com/api/bridge/view/${fileId}`;

    // Extract Google Drive ID from CDN response URL
    let driveId = null;
    if (rawUrl) {
        const idMatch = rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/) || rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (idMatch) driveId = idMatch[1];
    }

    const type = (mimeType || '').toLowerCase();

    if (type.startsWith('image/')) {
        // Images: High-quality thumbnail for web display
        if (driveId) {
            url = `https://drive.google.com/thumbnail?id=${driveId}&sz=w1200`;
        } else if (rawUrl) {
            url = rawUrl.replace('&export=download', '');
        }
    } else if (type.startsWith('video/')) {
        // Videos: Google Drive native player (embeddable via <iframe>, opens player in browser)
        if (driveId) {
            url = `https://drive.google.com/file/d/${driveId}/preview`;
        } else if (rawUrl) {
            url = rawUrl.replace('&export=download', '');
        }
    } else if (type === 'application/pdf') {
        // PDFs: Browser-native PDF viewer (no download trigger)
        if (driveId) {
            url = `https://drive.google.com/file/d/${driveId}/preview`;
        } else if (rawUrl) {
            url = rawUrl.replace('&export=download', '');
        }
    }
    // All other types (docs, zips, etc.): keep bridge/view fallback

    return url;
};

const authorizeTenantRoute = async (req, res, next) => {
    const route = req.originalUrl.split('?')[0];
    if (/^\/api\/(?:v1\/superadmin\/|super-admin\/|admin\/start-migration)/.test(route)) {
        return req.user.isSuperAdmin ? next() : res.status(403).json({ error: 'Super Admin required.' });
    }
    if (/^\/api\/user\/(?:workspaces|profile|change-password)(?:\/|$)/.test(route) || /^\/api\/notifications(?:\/|$)/.test(route)) return next();
    const context = req.tenantContext;
    if (!context) return res.status(403).json({ error: 'Workspace access denied.' });

    const role = context.role;
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    let permission = 'read';
    if (/^\/api\/settings\/api-key(?:\/|$)/.test(route)) permission = 'api_keys';
    else if (/^\/api\/(?:users(?:\/|$)|tenant\/invite(?:\/|$))/.test(route)) permission = 'members';
    else if (/^\/api\/(?:export\/zip|v1\/activity-logs)(?:\/|$)/.test(route)) permission = 'settings';
    else if (/^\/api\/inquiries(?:\/|$)/.test(route)) permission = 'content';
    else if (isWrite && /^\/api\/(?:settings(?:\/|$)|site-settings\/|plugins(?:\/|$))/.test(route)) permission = 'settings';
    else if (isWrite && route !== '/api/user/upload-avatar') permission = 'content';
    if (!can(role, permission)) return res.status(403).json({ error: 'Insufficient workspace permissions.' });
    if (context.elevated) {
        const recorded = await logActivity(context.tenantId, req.user.userId, req.user.name || req.user.email, 'super_admin', `Shadow access: ${req.method} ${route}`.slice(0, 255), 'attempt');
        if (!recorded) return res.status(503).json({ error: 'Audit service unavailable.' });
    }
    next();
};

// Mount before subrouters so their handlers cannot bypass tenant authorization.
app.use('/api', authorizeTenantRoute);

// ========================================================
// AUTH & API KEY MANAGEMENT (Protected — JWT required)
// ========================================================
const { router: authRoutes } = require('./server/routes/auth');
app.use('/api/settings', authRoutes);

// ========================================================
// POST CATEGORIES (Protected — JWT required)
// ========================================================
const postCategoryRoutes = require('./routes/postCategoryRoutes');
app.use('/api/v1/post-categories', postCategoryRoutes);

// --- Settings ---
app.get('/api/settings', async (req, res) => {
    try {
        const tid = getTenantId(req);
        if (!tid) return res.status(400).json({ error: 'No tenant assignment' });
        
        const [rows] = await db.execute(`
            SELECT s.*, t.subdomain 
            FROM settings s
            JOIN tenants t ON s.tenant_id = t.id
            WHERE s.tenant_id = ?
        `, [tid]);
        
        if (rows.length === 0) return res.status(404).json({ error: 'Settings not found' });
        
        const settings = rows[0];
        // Parse global_options if it's a string
        if (settings.global_options && typeof settings.global_options === 'string') {
            try { settings.global_options = JSON.parse(settings.global_options); } catch(e) {}
        }
        res.json(settings);
    } catch (error) {
        logOperationalError('[API ERROR] Get Settings:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.put(['/api/settings', '/api/site-settings/:tenantId'], async (req, res) => {
    const { 
        site_name, tagline, 
        support_email, 
        logo_url, footer_config, frontend_url 
    } = req.body;
    const tid = getTenantId(req);
    if (req.params.tenantId && parseTenantId(req.params.tenantId) !== tid) {
        return res.status(403).json({ error: 'Workspace access denied.' });
    }
    try {
        const globalOptions = JSON.stringify({
            site_name: site_name || '',
            tagline: tagline || '',
            support_email: support_email || '',
            footer_config: footer_config || null,
            frontend_url: frontend_url || ''
        });

        await db.execute(
            'UPDATE settings SET site_name = ?, tagline = ?, logo_url = ?, global_options = ? WHERE tenant_id = ?',
            [site_name, tagline, logo_url || null, globalOptions, tid]
        );
        res.json({ message: 'Configuration synchronized successfully' });
    } catch (error) {
        logOperationalError('[API ERROR] Update Settings:', error);
        res.status(500).json({ error: 'Registry write failure' });
    }
});

// --- API Keys → Moved to server/routes/auth.js ---

// --- Pages ---
app.get('/api/pages', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const [rows] = await db.execute('SELECT * FROM pages WHERE tenant_id = ?', [tid]);
        const pages = rows.map(row => {
            if (row.content && typeof row.content === 'string') {
                try { row.content = JSON.parse(row.content); } catch(e) {}
            }
            return row;
        });
        res.json(pages);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/pages/:id', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const [rows] = await db.execute('SELECT * FROM pages WHERE id = ? AND tenant_id = ?', [req.params.id, tid]);
        if (rows.length === 0) return res.status(404).json({ error: 'Page not found' });
        const page = rows[0];
        if (page.content && typeof page.content === 'string') {
            try { page.content = JSON.parse(page.content); } catch(e) {}
        }
        res.json(page);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/pages', async (req, res) => {
    const { title, slug, content, status } = req.body;
    const tid = getTenantId(req);

    // Validate mandatory fields
    if (!title || !title.trim()) return res.status(400).json({ error: 'Judul halaman wajib diisi.' });
    const finalSlug = (slug || title).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!finalSlug) return res.status(400).json({ error: 'Slug tidak valid.' });

    try {
        // Safely serialize content — default to '{}' if missing or not serializable
        // Sanitize &nbsp; entities injected by rich text editors before persistence
        let jsonContent = '{}';
        if (content !== undefined && content !== null) {
            const sanitized = typeof content === 'object' ? deepSanitizeContent(content) : content;
            jsonContent = typeof sanitized === 'object' ? JSON.stringify(sanitized) : sanitized;
        }

        // Defaults: is_in_navbar syncs with status

        // Check if a page with this slug already exists for this tenant
        const [existingRows] = await db.execute(
            'SELECT id, status FROM pages WHERE slug = ? AND tenant_id = ?',
            [finalSlug, tid]
        );

        let pageId;

        if (existingRows.length > 0) {
            // UPDATE existing page — strictly preserve priority
            pageId = existingRows[0].id;
            const currentStatus = status || existingRows[0].status || 'published';
            const finalNavbar = currentStatus === 'published' ? 1 : 0;
            
            await db.execute(
                'UPDATE pages SET title = ?, content = ?, status = ?, is_in_navbar = ? WHERE id = ? AND tenant_id = ?',
                [title.trim(), jsonContent, currentStatus, finalNavbar, pageId, tid]
            );
        } else {
            const finalStatus = status || 'published';
            const finalNavbar = finalStatus === 'published' ? 1 : 0;

            // INSERT new page — calculate next priority (1-based, gapless)
            const [maxRow] = await db.execute(
                'SELECT COALESCE(MAX(priority), 0) + 1 AS nextPriority FROM pages WHERE tenant_id = ?',
                [tid]
            );
            const nextPriority = maxRow[0].nextPriority;

            const [result] = await db.execute(
                'INSERT INTO pages (tenant_id, title, slug, content, status, is_in_navbar, priority) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [tid, title.trim(), finalSlug, jsonContent, finalStatus, finalNavbar, nextPriority]
            );
            pageId = result.insertId;

            // Layout Sync (only for new pages)
            await db.execute(
                "INSERT IGNORE INTO layouts (tenant_id, page_identifier, blocks_order) VALUES (?, ?, '[]')",
                [tid, 'index']
            );
        }

        logActivity(tid, req.user?.userId, req.user?.name || req.user?.email, req.user?.role, `Saved page: ${title.trim()}`, 'success');
        res.status(201).json({ message: 'Page saved successfully', id: pageId });
    } catch (error) {
        logOperationalError('Save Page Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.put('/api/pages/:id', async (req, res) => {
    const { title, slug, content, status } = req.body;
    const { id } = req.params;
    const tid = getTenantId(req);

    // Validate mandatory fields
    if (!title || !title.trim()) return res.status(400).json({ error: 'Judul halaman wajib diisi.' });
    const finalSlug = (slug || title).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    try {
        let currentStatus = status;
        if (!currentStatus) {
            const [rows] = await db.execute('SELECT status FROM pages WHERE id = ? AND tenant_id = ?', [id, tid]);
            if (rows.length === 0) return res.status(404).json({ error: 'Page not found' });
            currentStatus = rows[0].status;
        }

        const finalStatus = currentStatus || 'published';
        const finalNavbar = finalStatus === 'published' ? 1 : 0;

        // Safely serialize content — default to '{}' if missing
        // Sanitize &nbsp; entities injected by rich text editors before persistence
        let jsonContent = '{}';
        if (content !== undefined && content !== null) {
            const sanitized = typeof content === 'object' ? deepSanitizeContent(content) : content;
            jsonContent = typeof sanitized === 'object' ? JSON.stringify(sanitized) : sanitized;
        }

        // ✅ Priority is intentionally EXCLUDED from this query.
        // Priority must only change via the dedicated reorder endpoint.
        await db.execute(
            'UPDATE pages SET title = ?, slug = ?, content = ?, status = ?, is_in_navbar = ? WHERE id = ? AND tenant_id = ?',
            [title.trim(), finalSlug, jsonContent, finalStatus, finalNavbar, id, tid]
        );

        logActivity(tid, req.user?.userId, req.user?.name || req.user?.email, req.user?.role, `Updated page: ${title.trim()}`, 'success');
        res.json({ message: 'Page updated successfully' });
    } catch (error) {
        logOperationalError('Update Page Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.delete('/api/pages/:id', async (req, res) => {
    const { id } = req.params;
    const tid = getTenantId(req);
    try {
        const [rows] = await db.execute('SELECT title FROM pages WHERE id = ? AND tenant_id = ?', [id, tid]);
        const title = rows.length > 0 ? rows[0].title : `ID ${id}`;

        await db.execute('DELETE FROM pages WHERE id = ? AND tenant_id = ?', [id, tid]);

        logActivity(tid, req.user?.userId, req.user?.name || req.user?.email, req.user?.role, `Deleted page: ${title}`, 'success');
        res.json({ message: 'Page deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Duplicate Page ---
app.post('/api/pages/:id/duplicate', async (req, res) => {
    const { id } = req.params;
    const tid = getTenantId(req);

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Fetch original page scoped to tenant
        const [rows] = await connection.execute('SELECT * FROM pages WHERE id = ? AND tenant_id = ?', [id, tid]);
        if (rows.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ error: 'Page not found' });
        }

        const original = rows[0];
        const originalPriority = original.priority ?? 0;

        // 2. Rename title
        const newTitle = `${original.title} - Copy`;

        // 3. Generate unique slug
        let baseSlug = newTitle.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        let finalSlug = baseSlug;
        let suffix = 1;

        while (true) {
            const [existing] = await connection.execute(
                'SELECT id FROM pages WHERE slug = ? AND tenant_id = ?',
                [finalSlug, tid]
            );
            if (existing.length === 0) break;
            suffix++;
            finalSlug = `${baseSlug}-${suffix}`;
        }

        // 4. Shift priorities: push all pages with priority > P down by 1
        await connection.execute(
            'UPDATE pages SET priority = priority + 1 WHERE tenant_id = ? AND priority > ?',
            [tid, originalPriority]
        );

        // 5. Insert duplicate at priority P + 1 (directly below original)
        const contentStr = typeof original.content === 'object'
            ? JSON.stringify(original.content)
            : (original.content || '{}');

        const [result] = await connection.execute(
            'INSERT INTO pages (tenant_id, title, slug, content, status, is_in_navbar, priority) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [tid, newTitle, finalSlug, contentStr, 'draft', 0, originalPriority + 1]
        );

        await connection.commit();

        // 6. Return the new page
        const [newRows] = await db.execute('SELECT * FROM pages WHERE id = ? AND tenant_id = ?', [result.insertId, tid]);
        const newPage = newRows[0];
        if (newPage.content && typeof newPage.content === 'string') {
            try { newPage.content = JSON.parse(newPage.content); } catch(e) {}
        }

        console.log(`[DUPLICATE] Page "${original.title}" → "${newTitle}" at priority ${originalPriority + 1}`);
        res.status(201).json(newPage);
    } catch (error) {
        await connection.rollback();
        logOperationalError('[API ERROR] Duplicate Page:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        connection.release();
    }
});

app.patch('/api/pages/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const tid = getTenantId(req);

    console.log(`[TOGGLE] Attempting to update page ID ${id} to status: ${status} (tenant: ${tid})`);

    // Mandatory Validation: strictly allow only published or draft
    if (status !== 'published' && status !== 'draft') {
        return res.status(400).json({ error: 'Invalid status. Must be strictly "published" or "draft".' });
    }

    // Sync is_in_navbar with status: published → 1, draft → 0
    const isInNavbar = status === 'published' ? 1 : 0;

    try {
        // ✅ Single atomic query: update both status and is_in_navbar together
        const [result] = await db.execute(
            'UPDATE pages SET status = ?, is_in_navbar = ? WHERE id = ? AND tenant_id = ?',
            [status, isInNavbar, id, tid]
        );
        
        if (result.affectedRows === 0) {
            console.warn('[WARN]: No row updated. Check if ID exists or belongs to this tenant.');
            return res.status(404).json({ message: 'Page not found or access denied' });
        }

        console.log(`[TOGGLE] Page ${id} → status: ${status}, is_in_navbar: ${isInNavbar}`);
        res.json({ message: 'Status updated successfully' });
    } catch (error) {
        logOperationalError('[DATABASE ERROR]:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Reorder Page (Swap Priority) ---
app.patch('/api/pages/:id/reorder', async (req, res) => {
    const { id } = req.params;
    const { direction } = req.body;
    const tid = getTenantId(req);

    if (direction !== 'up' && direction !== 'down') {
        return res.status(400).json({ error: 'Direction must be "up" or "down".' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 0. Cleanup & Re-index: detect duplicate or zero-priority collisions
        //    If any pages share the same priority value, re-index all pages for this
        //    tenant to a clean, gapless 1-based sequence before attempting the swap.
        const [collisionCheck] = await connection.execute(
            'SELECT priority, COUNT(*) AS cnt FROM pages WHERE tenant_id = ? GROUP BY priority HAVING cnt > 1',
            [tid]
        );
        const [zeroCheck] = await connection.execute(
            'SELECT id FROM pages WHERE tenant_id = ? AND (priority IS NULL OR priority < 1) LIMIT 1',
            [tid]
        );

        if (collisionCheck.length > 0 || zeroCheck.length > 0) {
            console.log(`[REORDER] Priority collision or zero-value detected for tenant ${tid}. Running re-index...`);
            // Fetch all pages ordered by current priority (then by id as tiebreaker)
            const [allPages] = await connection.execute(
                'SELECT id FROM pages WHERE tenant_id = ? ORDER BY priority ASC, id ASC',
                [tid]
            );
            // Assign clean 1-based sequential priorities
            for (let i = 0; i < allPages.length; i++) {
                await connection.execute(
                    'UPDATE pages SET priority = ? WHERE id = ? AND tenant_id = ?',
                    [i + 1, allPages[i].id, tid]
                );
            }
            console.log(`[REORDER] Re-indexed ${allPages.length} pages for tenant ${tid} (1..${allPages.length})`);
        }

        // 1. Get the current page's priority (re-fetch after potential re-index)
        const [currentRows] = await connection.execute(
            'SELECT id, priority FROM pages WHERE id = ? AND tenant_id = ?',
            [id, tid]
        );
        if (currentRows.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ error: 'Page not found' });
        }

        const currentPage = currentRows[0];
        const currentPriority = currentPage.priority;

        // 2. Find the target neighbor
        let targetQuery;
        if (direction === 'up') {
            // Find the page with the highest priority that is still less than current
            targetQuery = 'SELECT id, priority FROM pages WHERE tenant_id = ? AND priority < ? ORDER BY priority DESC LIMIT 1';
        } else {
            // Find the page with the lowest priority that is still greater than current
            targetQuery = 'SELECT id, priority FROM pages WHERE tenant_id = ? AND priority > ? ORDER BY priority ASC LIMIT 1';
        }

        const [targetRows] = await connection.execute(targetQuery, [tid, currentPriority]);
        if (targetRows.length === 0) {
            // Already at the boundary — nothing to swap
            await connection.commit(); // commit the re-index if it happened
            connection.release();
            return res.status(200).json({ message: 'Already at boundary, no swap needed.' });
        }

        const targetPage = targetRows[0];

        // 3. Swap priorities in a single transaction
        await connection.execute('UPDATE pages SET priority = ? WHERE id = ? AND tenant_id = ?', [targetPage.priority, currentPage.id, tid]);
        await connection.execute('UPDATE pages SET priority = ? WHERE id = ? AND tenant_id = ?', [currentPriority, targetPage.id, tid]);

        await connection.commit();

        console.log(`[REORDER] Page ${currentPage.id} (pri: ${currentPriority}) ↔ Page ${targetPage.id} (pri: ${targetPage.priority})`);
        res.json({ message: 'Pages reordered successfully' });
    } catch (error) {
        await connection.rollback();
        logOperationalError('[API ERROR] Reorder page:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        connection.release();
    }
});

// --- Layouts ---
app.get('/api/layout', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const [rows] = await db.execute("SELECT blocks_order FROM layouts WHERE tenant_id = ? AND page_identifier = 'index'", [tid]);
        res.json(rows.length > 0 ? rows[0] : { blocks_order: [] });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.put('/api/layout', async (req, res) => {
    const { blocks_order } = req.body;
    const tid = getTenantId(req);
    try {
        const jsonOrder = typeof blocks_order === 'object' ? JSON.stringify(blocks_order) : blocks_order;
        await db.execute(
            "INSERT INTO layouts (tenant_id, page_identifier, blocks_order) VALUES (?, 'index', ?) ON DUPLICATE KEY UPDATE blocks_order = ?",
            [tid, jsonOrder, jsonOrder]
        );
        res.json({ message: 'Layout updated successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Posts ---
const resolvePostCategoryId = async (rawId, tenantId) => {
    if (rawId === undefined || rawId === null || rawId === '') return null;
    const categoryId = parseTenantId(rawId);
    if (!categoryId) return false;
    const [categories] = await db.execute('SELECT id FROM post_categories WHERE id = ? AND tenant_id = ? LIMIT 1', [categoryId, tenantId]);
    return categories.length ? categoryId : false;
};
app.get('/api/posts', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const [rows] = await db.execute(
            `SELECT posts.*, post_categories.name AS category_name, post_categories.slug AS category_slug
             FROM posts
             LEFT JOIN post_categories ON posts.category_id = post_categories.id AND post_categories.tenant_id = posts.tenant_id
             WHERE posts.tenant_id = ?`,
            [tid]
        );
        res.json(rows);
    } catch (error) {
        logOperationalError('[API ERROR] Get posts:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/posts', async (req, res) => {
    const { title, slug, content, excerpt, category, template_type, category_id, status } = req.body;
    const tid = getTenantId(req);
    try {
        // Sanitize &nbsp; entities injected by rich text editors before persistence
        const sanitized = typeof content === 'object' ? deepSanitizeContent(content) : content;
        const jsonContent = typeof sanitized === 'object' ? JSON.stringify(sanitized) : sanitized;

        // Resolve category_id: if provided use it, otherwise keep NULL
        const finalCategoryId = await resolvePostCategoryId(category_id, tid);
        if (finalCategoryId === false) return res.status(400).json({ error: 'Invalid category for this workspace.' });
        // template_type defaults to 'artikel' for backward compatibility
        const finalTemplateType = template_type || 'artikel';

        const [result] = await db.execute(
            'INSERT INTO posts (tenant_id, title, slug, content, excerpt, template_type, category_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [tid, title, slug, jsonContent, excerpt || '', finalTemplateType, finalCategoryId, status || 'published']
        );
        logActivity(tid, req.user?.userId, req.user?.name || req.user?.email, req.user?.role, `Saved post: ${title}`, 'success');
        res.status(201).json({ message: 'Post created successfully', id: result.insertId });
    } catch (error) {
        logOperationalError('[API ERROR] Create post:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.put('/api/posts/:id', async (req, res) => {
    const { title, slug, content, excerpt, category, template_type, category_id, status } = req.body;
    const { id } = req.params;
    const tid = getTenantId(req);
    try {
        // Sanitize &nbsp; entities injected by rich text editors before persistence
        const sanitized = typeof content === 'object' ? deepSanitizeContent(content) : content;
        const jsonContent = typeof sanitized === 'object' ? JSON.stringify(sanitized) : sanitized;

        // Resolve category_id: if provided use it, otherwise keep NULL
        const finalCategoryId = await resolvePostCategoryId(category_id, tid);
        if (finalCategoryId === false) return res.status(400).json({ error: 'Invalid category for this workspace.' });
        // template_type defaults to 'artikel' for backward compatibility
        const finalTemplateType = template_type || 'artikel';

        await db.execute(
            'UPDATE posts SET title = ?, slug = ?, content = ?, excerpt = ?, template_type = ?, category_id = ?, status = ? WHERE id = ? AND tenant_id = ?',
            [title, slug, jsonContent, excerpt || '', finalTemplateType, finalCategoryId, status || 'published', id, tid]
        );
        logActivity(tid, req.user?.userId, req.user?.name || req.user?.email, req.user?.role, `Updated post: ${title}`, 'success');
        res.json({ message: 'Post updated successfully' });
    } catch (error) {
        logOperationalError('[API ERROR] Update post:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.delete('/api/posts/:id', async (req, res) => {
    const { id } = req.params;
    const tid = getTenantId(req);
    try {
        const [rows] = await db.execute('SELECT title FROM posts WHERE id = ? AND tenant_id = ?', [id, tid]);
        const title = rows.length > 0 ? rows[0].title : `ID ${id}`;

        await db.execute('DELETE FROM posts WHERE id = ? AND tenant_id = ?', [id, tid]);

        logActivity(tid, req.user?.userId, req.user?.name || req.user?.email, req.user?.role, `Deleted post: ${title}`, 'success');
        res.json({ message: 'Post deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Duplicate Post ---
app.post('/api/posts/:id/duplicate', async (req, res) => {
    const { id } = req.params;
    const tid = getTenantId(req);

    try {
        // 1. Fetch original post scoped to tenant
        const [rows] = await db.execute('SELECT * FROM posts WHERE id = ? AND tenant_id = ?', [id, tid]);
        if (rows.length === 0) return res.status(404).json({ error: 'Post not found' });

        const original = rows[0];

        // 2. Rename title
        const newTitle = `${original.title} - Copy`;

        // 3. Generate unique slug
        let baseSlug = newTitle.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        let finalSlug = baseSlug;
        let suffix = 1;

        while (true) {
            const [existing] = await db.execute(
                'SELECT id FROM posts WHERE slug = ? AND tenant_id = ?',
                [finalSlug, tid]
            );
            if (existing.length === 0) break;
            suffix++;
            finalSlug = `${baseSlug}-${suffix}`;
        }

        // 4. Clone with clean data — status defaults to 'draft'
        const contentStr = typeof original.content === 'object'
            ? JSON.stringify(original.content)
            : (original.content || '{}');

        const [result] = await db.execute(
            'INSERT INTO posts (tenant_id, title, slug, content, excerpt, category, template_type, category_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [tid, newTitle, finalSlug, contentStr, original.excerpt || '', original.category || null, original.template_type || 'artikel', original.category_id || null, 'draft']
        );

        // 5. Return success with new post data
        const [newRows] = await db.execute('SELECT * FROM posts WHERE id = ? AND tenant_id = ?', [result.insertId, tid]);
        const newPost = newRows[0];
        if (newPost.content && typeof newPost.content === 'string') {
            try { newPost.content = JSON.parse(newPost.content); } catch(e) {}
        }

        res.status(201).json(newPost);
    } catch (error) {
        logOperationalError('[API ERROR] Duplicate Post:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.patch('/api/posts/:id/status', async (req, res) => {
    const { id } = req.params;
    const tid = getTenantId(req);
    // ✅ BUG FIX: Read status from req.body (was referencing undefined `status` variable)
    const { status } = req.body;
    const validStatuses = ['published', 'draft'];
    const finalStatus = validStatuses.includes(status) ? status : 'draft';

    try {
        console.log(`[REQUEST] Incoming Status Toggle for Post ID: ${id} -> ${finalStatus} (tenant: ${tid})`);
        
        // Ensure the SQL query uses single quotes for string values as requested
        const [result] = await db.execute(`UPDATE posts SET status = '${finalStatus}' WHERE id = ? AND tenant_id = ?`, [id, tid]);
        
        if (result.affectedRows === 0) {
            console.warn(`[WARN] No post found with ID: ${id} for tenant: ${tid}`);
            return res.status(404).json({ success: false, message: 'Post tidak ditemukan atau akses ditolak' });
        }

        console.log('[SUCCESS] Post status updated in DB');
        res.json({ success: true, message: 'Status diperbarui' });
    } catch (error) {
        logOperationalError('[DATABASE ERROR]:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// --- Media ---
app.get('/api/media', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const folder_id = req.query.folder_id ? parseInt(req.query.folder_id) : null;
        let rows;
        if (req.query.folder_id !== undefined) {
            if (folder_id) {
                [rows] = await db.execute('SELECT * FROM media WHERE tenant_id = ? AND folder_id = ?', [tid, folder_id]);
            } else {
                [rows] = await db.execute('SELECT * FROM media WHERE tenant_id = ? AND folder_id IS NULL', [tid]);
            }
        } else {
            // If folder_id is not provided in query at all, return all for global search
            [rows] = await db.execute('SELECT * FROM media WHERE tenant_id = ?', [tid]);
        }

        // Task 1: Silent Sync
        const processingItems = rows.filter(r => r.status === 'processing');
        if (processingItems.length > 0 && can(req.tenantContext.role, 'content')) {
            try {
                const apiKey = process.env.CDN_API_KEY;
                const axios = require('axios');
                const { data: kroomboxFiles } = await axios.get('https://api-cdn.kroombox.com/api/bridge/files', {
                    headers: { 'x-api-key': apiKey }
                });

                if (Array.isArray(kroomboxFiles)) {
                    for (let item of processingItems) {
                        const kf = kroomboxFiles.find(f => f.fileId === item.filename || f.id === item.filename);
                        if (kf && kf.status === 'ready') {
                            const rawUrl = kf.url || kf.webContentLink || kf.directUrl;
                            const newUrl = buildMediaUrl(item.filename, item.file_type, rawUrl);

                            await db.execute('UPDATE media SET status = ?, file_url = ? WHERE id = ? AND tenant_id = ?', ['ready', newUrl, item.id, tid]);
                            item.status = 'ready';
                            item.file_url = newUrl;
                        }
                    }
                }
            } catch (syncErr) {
                logOperationalError('[SILENT SYNC ERROR]', syncErr);
            }
        }

        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/media', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        
        const tid = getTenantId(req);
        const folder_id = req.body.folder_id ? parseTenantId(req.body.folder_id) : null;
        if (req.body.folder_id && !folder_id) return res.status(400).json({ error: 'Invalid folder ID.' });
        if (folder_id) {
            const [folders] = await db.execute('SELECT id FROM media_folders WHERE id = ? AND tenant_id = ?', [folder_id, tid]);
            if (!folders.length) return res.status(404).json({ error: 'Folder not found.' });
        }
        
        // Task 2: Dynamic ProjectName Pathing (Folder Creation)
        const cdnPath = await buildCdnPath(tid, folder_id);

        // Wait for CDN response BEFORE attempting to save to MySQL
        let cdnResponse;
        try {
            cdnResponse = await cdnService.upload(req.file.buffer, req.file.originalname, req.file.mimetype, cdnPath);
        } catch (cdnErr) {
            logOperationalError('[CDN ERROR] Upload failed:', cdnErr);
            return res.status(502).json({ error: 'Failed to upload to CDN' });
        }

        // Task 1 & 4: Capturing fileId and Metadata from CDN Response
        const fileId = cdnResponse.fileId;
        
        // Task 1: Validation
        if (!fileId) {
            console.error('[CDN ERROR] Upload response contained no file identifier.');
            throw new Error("Failed to capture fileId from CDN");
        }

        const file_type = cdnResponse.mimeType || req.file.mimetype;
        const rawUrl = cdnResponse.url || cdnResponse.webContentLink || cdnResponse.directUrl;
        
        const file_url = buildMediaUrl(fileId, file_type, rawUrl);
        
        // Task 4: Syncing MySQL with CDN Response / File Metadata
        const file_size = cdnResponse.size || req.file.size || 0;
        const uploaded_by = req.user.userId;
        const display_name = cdnResponse.originalName || req.file.originalname;
        const status = cdnResponse.status || 'processing';

        // Immediate Database Record
        try {
            const [result] = await db.execute(
                'INSERT INTO media (tenant_id, filename, file_url, file_type, file_size, folder_id, uploaded_by, file_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [tid, fileId, file_url, file_type, file_size, folder_id, uploaded_by, display_name, status]
            );

            console.log(`[MEDIA] Record created for tenant ${tid}.`);

            logActivity(tid, req.user?.userId, req.user?.name || req.user?.email, req.user?.role, `Uploaded media: ${display_name}`, 'success');

            res.status(201).json({ 
                success: true,
                message: 'Aset berhasil diunggah dan direkam',
                id: result.insertId,
                url: file_url,
                folder_id
            });
        } catch (dbErr) {
            // Task 3: Database Fallback Log
            console.error('[DATABASE ERROR] MySQL INSERT failed! Asset is in CDN but missing in UI.');
            console.error(`[CRITICAL] Media metadata save failed for tenant ${tid}.`);
            console.error('Error code:', dbErr.code || 'UNKNOWN');

            res.status(201).json({ 
                success: true, 
                message: 'Aset terunggah ke CDN namun gagal sinkronisasi DB (Lihat Log Server)',
                url: file_url,
                fileId: fileId
            });
        }
    } catch (error) {
        logOperationalError('[MEDIA] ❌ General Upload Error:', error);
        res.status(500).json({ error: 'Storage synchronization failure' });
    }
});

app.delete('/api/media/:id', async (req, res) => {
    const { id } = req.params;
    const tid = getTenantId(req);
    try {
        // Find file identity first
        const [rows] = await db.execute('SELECT filename, file_name FROM media WHERE id = ? AND tenant_id = ?', [id, tid]);
        if (rows.length === 0) return res.status(404).json({ error: 'Resource not found or unauthorized' });
        
        const filename = rows[0].filename; // This holds Kroombox fileId now

        // Physical Deletion from CDN
        if (filename && !filename.startsWith('http')) {
            try {
                await cdnService.delete(filename);
            } catch(e) { 
                logOperationalError('CDN delete failed:', e);
            }
        }

        // Registry Deletion
        await db.execute('DELETE FROM media WHERE id = ? AND tenant_id = ?', [id, tid]);
        
        const display_name = rows[0].file_name || rows[0].filename;
        logActivity(tid, req.user?.userId, req.user?.name || req.user?.email, req.user?.role, `Deleted media: ${display_name}`, 'success');

        res.json({ message: 'Media asset successfully purged' });
    } catch (error) {
        logOperationalError('Purge Error:', error);
        res.status(500).json({ error: 'Internal system purge failure' });
    }
});

// ★ Bulk Delete — Accepts array of IDs, deletes from both CDN and MySQL
app.post('/api/media/bulk-delete', async (req, res) => {
    const { ids } = req.body;
    const tid = getTenantId(req);

    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Array of media IDs is required' });
    }

    const results = { deleted: 0, failed: 0, errors: [] };

    for (const id of ids) {
        try {
            // 1. Find the CDN fileId (stored as `filename` in MySQL)
            const [rows] = await db.execute(
                'SELECT filename FROM media WHERE id = ? AND tenant_id = ?', [id, tid]
            );
            if (rows.length === 0) {
                results.failed++;
                results.errors.push({ id, error: 'Not found' });
                continue;
            }

            const filename = rows[0].filename;

            // 2. Delete from CDN (Kroombox)
            if (filename && !filename.startsWith('http')) {
                try {
                    await cdnService.delete(filename);
                } catch (e) {
                    logOperationalError('[BULK DELETE] CDN delete failed:', e);
                }
            }

            // 3. Delete from MySQL
            await db.execute('DELETE FROM media WHERE id = ? AND tenant_id = ?', [id, tid]);
            results.deleted++;
        } catch (err) {
            results.failed++;
            results.errors.push({ id, error: 'Operation failed' });
            logOperationalError('[BULK DELETE] Deletion failed:', err);
        }
    }

    console.log(`[BULK DELETE] Tenant ${tid} | Deleted: ${results.deleted} | Failed: ${results.failed}`);
    res.json(results);
});

// ★ Fix Video URLs — Super Admin endpoint to migrate existing video records
// Finds all video records using old /uc?id= or /bridge/view/ patterns
// and rewrites them to /file/d/.../preview for native browser playback.
// Idempotent: records already using /preview are skipped.
app.post('/api/v1/superadmin/fix-video-urls', async (req, res) => {
    if (!req.user || req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Super Admin only' });
    }

    try {
        // Fetch all video records that are NOT already using /preview
        const [rows] = await db.execute(
            `SELECT id, filename, file_url, file_type FROM media
             WHERE file_type LIKE 'video/%'
             AND (file_url NOT LIKE '%/preview' OR file_url IS NULL)`
        );

        const results = { updated: 0, skipped: 0, errors: [] };

        for (const row of rows) {
            try {
                // Extract Drive ID from existing URL
                let driveId = null;

                // Pattern: /uc?id=DRIVE_ID or ?id=DRIVE_ID
                const ucMatch = (row.file_url || '').match(/[?&]id=([a-zA-Z0-9_-]+)/);
                if (ucMatch) driveId = ucMatch[1];

                // Pattern: /file/d/DRIVE_ID/... (already correct format, different issue)
                if (!driveId) {
                    const fileMatch = (row.file_url || '').match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                    if (fileMatch) driveId = fileMatch[1];
                }

                // Fallback: use the CDN fileId stored in `filename` column
                if (!driveId && row.filename && !row.filename.startsWith('http')) {
                    driveId = row.filename;
                }

                if (!driveId) {
                    results.skipped++;
                    results.errors.push({ id: row.id, reason: 'Could not extract Drive ID' });
                    continue;
                }

                const newUrl = `https://drive.google.com/file/d/${driveId}/preview`;
                await db.execute('UPDATE media SET file_url = ? WHERE id = ?', [newUrl, row.id]);
                results.updated++;
                console.log(`[FIX VIDEO] ID ${row.id} → ${newUrl}`);
            } catch (err) {
                results.errors.push({ id: row.id, reason: 'Operation failed' });
            }
        }

        console.log(`[FIX VIDEO URLS] Updated: ${results.updated} | Skipped: ${results.skipped}`);
        res.json({ message: 'Video URL migration complete', ...results });
    } catch (err) {
        logOperationalError('[FIX VIDEO URLS] Error:', err);
        res.status(500).json({ error: 'Migration failed' });
    }
});

// Task 3: CDN Status Check Endpoint — allows frontend to poll processing state
app.get('/api/media/status/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const tid = getTenantId(req);
    try {
        const [rows] = await db.execute('SELECT id, status, file_url, file_type FROM media WHERE filename = ? AND tenant_id = ?', [fileId, tid]);
        if (rows.length === 0) return res.status(404).json({ error: 'Media not found' });

        const mediaId = rows[0].id;
        const mimeType = rows[0].file_type || '';
        
        // If already marked ready in DB, return immediately
        if (rows[0].status === 'ready') {
            return res.json({ status: 'ready', url: rows[0].file_url });
        }

        if (!can(req.tenantContext.role, 'content')) return res.status(403).json({ error: 'Insufficient workspace permissions.' });

        // Otherwise check live status from CDN (pass mimeType for URL transformation)
        const statusData = await cdnService.getStatus(fileId, mimeType);
        const newStatus = statusData.status || 'ready';
        
        const rawUrl = statusData.url;
        const newUrl = buildMediaUrl(fileId, mimeType, rawUrl);

        // Update DB if status changed
        if (newStatus !== rows[0].status) {
            if (newStatus === 'ready') {
                await db.execute('UPDATE media SET status = ?, file_url = ? WHERE id = ? AND tenant_id = ?', [newStatus, newUrl, mediaId, tid]);
                console.log(`[MEDIA] Status updated for tenant ${tid}.`);
            } else {
                await db.execute('UPDATE media SET status = ? WHERE id = ? AND tenant_id = ?', [newStatus, mediaId, tid]);
            }
        }

        res.json({ status: newStatus, url: newUrl });
    } catch (error) {
        logOperationalError('CDN Status Check Error:', error);
        res.status(500).json({ error: 'Failed to check CDN status' });
    }
});

app.patch('/api/media/:id', async (req, res) => {
    const { id } = req.params;
    const { file_name, folder_id } = req.body;
    const tid = getTenantId(req);

    if (file_name === undefined && folder_id === undefined) return res.status(400).json({ error: 'No update data provided' });

    try {
        if (folder_id !== undefined && folder_id !== null) {
            const folderId = parseTenantId(folder_id);
            if (!folderId) return res.status(400).json({ error: 'Invalid folder ID.' });
            const [folders] = await db.execute('SELECT id FROM media_folders WHERE id = ? AND tenant_id = ?', [folderId, tid]);
            if (!folders.length) return res.status(404).json({ error: 'Folder not found.' });
        }
        let query = 'UPDATE media SET ';
        let params = [];
        if (file_name !== undefined) {
            query += 'file_name = ?, ';
            params.push(file_name);
        }
        if (folder_id !== undefined) {
            query += 'folder_id = ?, ';
            params.push(folder_id);
        }
        query = query.slice(0, -2) + ' WHERE id = ? AND tenant_id = ?';
        params.push(id, tid);

        const [result] = await db.execute(query, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Media not found or unauthorized' });
        }

        res.json({ message: 'Media updated successfully' });
    } catch (error) {
        logOperationalError('Update Error:', error);
        res.status(500).json({ error: 'Internal system update failure' });
    }
});

// --- Folders ---
app.get('/api/folders', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const folder_id = req.query.folder_id ? parseTenantId(req.query.folder_id) : null;
        if (req.query.folder_id && !folder_id) return res.status(400).json({ error: 'Invalid folder ID.' });
        
        let rows;
        if (req.query.folder_id !== undefined) {
            if (folder_id) {
                [rows] = await db.execute('SELECT * FROM media_folders WHERE tenant_id = ? AND parent_id = ? ORDER BY name ASC', [tid, folder_id]);
            } else {
                [rows] = await db.execute('SELECT * FROM media_folders WHERE tenant_id = ? AND parent_id IS NULL ORDER BY name ASC', [tid]);
            }
        } else {
            [rows] = await db.execute('SELECT * FROM media_folders WHERE tenant_id = ? ORDER BY name ASC', [tid]);
        }
        
        res.json(rows);
    } catch (error) {
        logOperationalError('Fetch Folders Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/folders', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const { name, parent_id } = req.body;
        
        if (!name) return res.status(400).json({ error: 'Folder name is required' });
        if (parent_id !== undefined && parent_id !== null) {
            const parentId = parseTenantId(parent_id);
            if (!parentId) return res.status(400).json({ error: 'Invalid parent folder ID.' });
            const [parents] = await db.execute('SELECT id FROM media_folders WHERE id = ? AND tenant_id = ?', [parentId, tid]);
            if (!parents.length) return res.status(404).json({ error: 'Parent folder not found.' });
        }
        
        const [result] = await db.execute(
            'INSERT INTO media_folders (tenant_id, name, parent_id) VALUES (?, ?, ?)',
            [tid, name, parent_id || null]
        );
        
        // Task 3: Log the folder hierarchy for debugging
        // Kroombox creates sub-folders automatically on first upload, so we only track in MySQL
        console.log(`[FOLDER] Created "${name}" (id: ${result.insertId}) | parent_id: ${parent_id || 'ROOT'} | tenant: ${tid}`);
        
        res.status(201).json({ id: result.insertId, name, parent_id });
    } catch (error) {
        logOperationalError('Create Folder Error:', error);
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

app.patch('/api/folders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const tid = getTenantId(req);
        const { name, parent_id } = req.body;
        
        if (name === undefined && parent_id === undefined) return res.status(400).json({ error: 'No update data provided' });
        if (parent_id !== undefined && parent_id !== null) {
            const parentId = parseTenantId(parent_id);
            if (!parentId || parentId === parseTenantId(id)) return res.status(400).json({ error: 'Invalid parent folder ID.' });
            const [parents] = await db.execute('SELECT id FROM media_folders WHERE id = ? AND tenant_id = ?', [parentId, tid]);
            if (!parents.length) return res.status(404).json({ error: 'Parent folder not found.' });
        }
        
        let query = 'UPDATE media_folders SET ';
        let params = [];
        if (name !== undefined) {
            query += 'name = ?, ';
            params.push(name);
        }
        if (parent_id !== undefined) {
            query += 'parent_id = ?, ';
            params.push(parent_id);
        }
        query = query.slice(0, -2) + ' WHERE id = ? AND tenant_id = ?';
        params.push(id, tid);
        
        const [result] = await db.execute(query, params);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Folder not found or unauthorized' });
        
        res.json({ message: 'Folder updated successfully' });
    } catch (error) {
        logOperationalError('Update Folder Error:', error);
        res.status(500).json({ error: 'Failed to update folder' });
    }
});

app.delete('/api/folders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const tid = getTenantId(req);
        
        const [result] = await db.execute('DELETE FROM media_folders WHERE id = ? AND tenant_id = ?', [id, tid]);
        
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Folder not found or unauthorized' });
        
        res.json({ message: 'Folder deleted successfully' });
    } catch (error) {
        logOperationalError('Delete Folder Error:', error);
        res.status(500).json({ error: 'Failed to delete folder' });
    }
});

// --- Activity Logs ---
app.get('/api/v1/activity-logs', authenticateToken, async (req, res) => {
    try {
        const tid = req.user.tenant_id;
        const [logs] = await db.execute(
            `SELECT al.*, u.name as real_actor_name 
             FROM activity_logs al 
             LEFT JOIN users u ON al.user_id = u.id 
             WHERE al.tenant_id = ? 
             ORDER BY al.created_at DESC LIMIT 50`,
            [tid]
        );
        res.json(logs);
    } catch (error) {
        logOperationalError('[API ERROR] Get activity logs:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Dashboard ---
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const [userRows] = await db.execute("SELECT COUNT(*) as total FROM tenant_users WHERE tenant_id = ? AND status = 'active'", [tid]);
        
        let totalInquiries = 0;
        if (tid) {
            const [inqRows] = await db.execute('SELECT COUNT(*) as total FROM contact_inquiries WHERE tenant_id = ?', [tid]);
            totalInquiries = inqRows[0].total;
        }

        res.json({ totalUsers: userRows[0].total, totalInquiries });
    } catch (error) {
        logOperationalError('[API ERROR] Get Dashboard Stats:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/v1/dashboard/charts', async (req, res) => {
    try {
        const tid = getTenantId(req);
        if (!tid) return res.status(400).json({ error: 'Tenant ID required' });

        const timeRange = req.query.timeRange || '7d';
        let dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
        if (timeRange === '30d') dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
        else if (timeRange === '90d') dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 90 DAY)';
        else if (timeRange === 'all') dateFilter = "'1970-01-01'";

        // 1. Activity Trend
        const [activityRows] = await db.execute(`
            SELECT DATE(created_at) as date, COUNT(*) as aktivitas 
            FROM activity_logs 
            WHERE tenant_id = ? AND created_at >= ${dateFilter}
            GROUP BY DATE(created_at) 
            ORDER BY DATE(created_at) ASC
        `, [tid]);

        const daysOfWeek = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];
        
        const activityTrend = activityRows.map(row => {
            const dateObj = new Date(row.date);
            let dateLabel = daysOfWeek[dateObj.getDay()];
            if (timeRange !== '7d') {
                dateLabel = `${dateObj.getDate()} ${months[dateObj.getMonth()]}`;
            }
            return {
                date: dateLabel,
                aktivitas: row.aktivitas
            };
        });

        // 2. Role Distribution
        const [roleRows] = await db.execute(`
            SELECT role as name, COUNT(*) as value 
            FROM tenant_users 
            WHERE tenant_id = ? AND status = 'active'
            GROUP BY role
        `, [tid]);

        const roleDistribution = roleRows.map(r => ({
            name: r.name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),
            value: r.value
        }));

        // 3. Content Distribution
        const [pages] = await db.execute('SELECT COUNT(*) as total FROM pages WHERE tenant_id = ?', [tid]);
        const [posts] = await db.execute('SELECT COUNT(*) as total FROM posts WHERE tenant_id = ?', [tid]);
        const [inquiries] = await db.execute('SELECT COUNT(*) as total FROM contact_inquiries WHERE tenant_id = ?', [tid]);
        const [comments] = await db.execute('SELECT COUNT(*) as total FROM comments WHERE tenant_id = ? AND status = ?', [tid, 'approved']);

        const contentDistribution = [
            { name: 'Halaman', total: pages[0].total },
            { name: 'Post', total: posts[0].total },
            { name: 'Inquiries', total: inquiries[0].total },
            { name: 'Komentar', total: comments[0].total }
        ];

        res.json({
            activityTrend,
            roleDistribution,
            contentDistribution
        });
    } catch (error) {
        logOperationalError('[API ERROR] Get Dashboard Charts:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// --- Users (Tenant Users) ---
app.get('/api/users', async (req, res) => {
    try {
        // Use explicit req.user.tenant_id enforced by auth middleware
        const tid = req.user.tenant_id;
        const [rows] = await db.execute(`
            SELECT u.id as user_id, u.name, u.email, u.profile_picture_url, tu.role AS role,
                   IFNULL(tu.status, 'active') as status
            FROM tenant_users tu
            JOIN users u ON tu.user_id = u.id
            WHERE tu.tenant_id = ?
            ORDER BY tu.role ASC, u.name ASC
        `, [tid]);
        res.json(rows);
    } catch (error) {
        logOperationalError('[API ERROR] Get tenant users:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Invite User to Tenant ---
app.post('/api/tenant/invite', async (req, res) => {
    const { email, role } = req.body;
    const tid = getTenantId(req);
    const inviterUserId = req.user.userId;

    if (!email || !email.trim()) {
        return res.status(400).json({ error: 'Email wajib diisi.' });
    }
    const validRoles = ['admin', 'co_admin', 'content_creative', 'guest'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Role undangan tidak valid.' });
    if (['admin', 'co_admin'].includes(role) && !can(req.tenantContext.role, 'assign_admin')) {
        return res.status(403).json({ error: 'Anda tidak dapat memberikan role tersebut.' });
    }
    const finalRole = role;

    try {
        // 1. Check if user exists
        const [users] = await db.execute('SELECT id, name FROM users WHERE email = ?', [email.trim()]);
        if (users.length === 0) {
            return res.status(404).json({ error: 'User tidak ditemukan. Pastikan email sudah terdaftar di sistem.' });
        }
        const targetUser = users[0];

        // 2. Cannot invite yourself
        if (targetUser.id === inviterUserId) {
            return res.status(400).json({ error: 'Anda tidak dapat mengundang diri sendiri.' });
        }

        // 3. Check if already a member of this tenant
        const [existing] = await db.execute(
            'SELECT user_id, status FROM tenant_users WHERE tenant_id = ? AND user_id = ?',
            [tid, targetUser.id]
        );
        if (existing.length > 0) {
            const st = existing[0].status || 'active';
            if (st === 'active') return res.status(400).json({ error: 'Pengguna sudah menjadi anggota tenant ini.' });
            if (st === 'pending') return res.status(400).json({ error: 'Undangan sudah terkirim dan menunggu respons.' });
        }

        // 4. Get tenant name for notification message
        const [tenantRows] = await db.execute('SELECT name FROM tenants WHERE id = ?', [tid]);
        const tenantName = tenantRows.length > 0 ? tenantRows[0].name : 'Tenant';

        // 5. Insert tenant_users with status 'pending'
        if (existing.length > 0) {
            await db.execute("UPDATE tenant_users SET role = ?, status = 'pending' WHERE tenant_id = ? AND user_id = ?", [finalRole, tid, targetUser.id]);
        } else {
            await db.execute("INSERT INTO tenant_users (tenant_id, user_id, role, status) VALUES (?, ?, ?, 'pending')", [tid, targetUser.id, finalRole]);
        }

        // 6. Create notification for the invited user
        const roleLabel = finalRole === 'admin' ? 'Admin' : finalRole === 'co_admin' ? 'Co-Admin' : finalRole === 'content_creative' ? 'Content Creative' : 'Guest';
        const notifMessage = `Anda diundang bergabung ke "${tenantName}" sebagai ${roleLabel}.`;
        await db.execute(
            "INSERT INTO notifications (user_id, tenant_id, type, message) VALUES (?, ?, 'invitation', ?)",
            [targetUser.id, tid, notifMessage]
        );

        console.log(`[INVITE] Invitation created for tenant ${tid}.`);
        res.status(201).json({ message: `Undangan berhasil dikirim ke ${email}.` });
    } catch (error) {
        logOperationalError('[API ERROR] Invite user:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.delete('/api/users/:user_id', async (req, res) => {
    const userId = parseTenantId(req.params.user_id);
    const tid = getTenantId(req);
    if (!userId) return res.status(400).json({ error: 'ID pengguna tidak valid.' });
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [members] = await connection.execute(
            'SELECT role, status FROM tenant_users WHERE tenant_id = ? AND user_id = ? FOR UPDATE',
            [tid, userId]
        );
        if (!members.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'Anggota tidak ditemukan.' });
        }
        const targetRole = members[0].role;
        if (['admin', 'co_admin'].includes(targetRole) && !can(req.tenantContext.role, 'remove_admin')) {
            await connection.rollback();
            return res.status(403).json({ error: 'Anda tidak dapat menghapus anggota dengan role tersebut.' });
        }
        if (targetRole === 'admin' && members[0].status === 'active') {
            const [admins] = await connection.execute(
                "SELECT user_id FROM tenant_users WHERE tenant_id = ? AND role = 'admin' AND status = 'active' FOR UPDATE",
                [tid]
            );
            if (admins.length <= 1) {
                await connection.rollback();
                return res.status(409).json({ error: 'Admin aktif terakhir tidak dapat dihapus.' });
            }
        }
        await connection.execute('DELETE FROM tenant_users WHERE user_id = ? AND tenant_id = ?', [userId, tid]);
        await connection.commit();
        res.json({ message: 'User removed successfully' });
    } catch (error) {
        if (connection) await connection.rollback();
        logOperationalError('[API ERROR] Remove tenant member:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        if (connection) connection.release();
    }
});

// --- User Workspaces (All active tenants for the logged-in user) ---
app.get('/api/user/workspaces', async (req, res) => {
    try {
        const userId = req.user.userId;
        // Super Admin Shadow Mode: return ALL tenants as accessible workspaces
        // This prevents the frontend tenant guard from triggering eviction
        if (req.user.isSuperAdmin === true) {
            const [allTenants] = await db.execute(`
                SELECT t.id as tenant_id, t.name as tenant_name, t.subdomain, 'admin' as role, 'active' as status
                FROM tenants t
                ORDER BY t.name ASC
            `);
            return res.json(allTenants);
        }

        // Identify primary tenant (where user is admin)
        const [adminTenants] = await db.execute(
            "SELECT tenant_id FROM tenant_users WHERE user_id = ? AND role = 'admin' AND status = 'active' ORDER BY tenant_id ASC LIMIT 1",
            [userId]
        );
        const primaryTenantId = adminTenants.length > 0 ? adminTenants[0].tenant_id : null;

        const [rows] = await db.execute(`
            SELECT tu.tenant_id, t.name as tenant_name, t.subdomain, tu.role, tu.status
            FROM tenant_users tu
            JOIN tenants t ON tu.tenant_id = t.id
            WHERE tu.user_id = ? AND tu.status = 'active' AND t.status = 'active'
            ORDER BY tu.role ASC, t.name ASC
        `, [userId]);

        // Annotate each workspace with type: 'primary' (admin) or 'guest' (co_admin, content_creative, guest)
        const annotated = rows.map(ws => ({
            ...ws,
            workspace_type: ws.role === 'admin' && ws.tenant_id === primaryTenantId ? 'primary' : 'guest'
        }));
        res.json(annotated);
    } catch (error) {
        logOperationalError('[API ERROR] Get user workspaces:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// ★ NOTIFICATION SYSTEM ★
// =============================================================

// GET /api/notifications — Fetch all notifications for logged-in user
app.get('/api/notifications', async (req, res) => {
    try {
        const userId = req.user.userId;
        const [notifications] = await db.execute(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
            [userId]
        );
        res.json(notifications);
    } catch (error) {
        logOperationalError('[API ERROR] Get notifications:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /api/notifications/latest-alert — Poll for active alerts
app.get('/api/notifications/latest-alert', async (req, res) => {
    try {
        const userId = req.user.userId;
        const [alerts] = await db.execute(
            "SELECT * FROM notifications WHERE user_id = ? AND type = 'alert' AND is_read = 0 ORDER BY created_at DESC LIMIT 1",
            [userId]
        );
        res.json(alerts.length > 0 ? alerts[0] : null);
    } catch (error) {
        logOperationalError('[API ERROR] Get latest alert:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// PATCH /api/notifications/:id/read — Mark notification as read
app.patch('/api/notifications/:id/read', async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        await db.execute(
            'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        res.json({ message: 'Notification marked as read.' });
    } catch (error) {
        logOperationalError('[API ERROR] Mark notification read:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/notifications/respond — Accept or Reject invitation
app.post('/api/notifications/respond', async (req, res) => {
    const { notification_id, action } = req.body;
    const userId = req.user.userId;

    if (!notification_id || !['accept', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'notification_id dan action (accept/reject) wajib diisi.' });
    }

    try {
        // 1. Fetch the notification
        const [notifs] = await db.execute(
            "SELECT * FROM notifications WHERE id = ? AND user_id = ? AND type = 'invitation'",
            [notification_id, userId]
        );
        if (notifs.length === 0) {
            return res.status(404).json({ error: 'Notifikasi tidak ditemukan.' });
        }

        const notif = notifs[0];
        const tenantId = notif.tenant_id;

        if (!tenantId) {
            return res.status(400).json({ error: 'Data undangan tidak valid (tenant_id missing).' });
        }

        const [pending] = await db.execute("SELECT user_id FROM tenant_users WHERE tenant_id = ? AND user_id = ? AND status = 'pending'", [tenantId, userId]);
        if (!pending.length) return res.status(409).json({ error: 'Undangan sudah tidak berlaku.' });

        if (action === 'accept') {
            const [activeTenants] = await db.execute("SELECT id FROM tenants WHERE id = ? AND status = 'active'", [tenantId]);
            if (!activeTenants.length) return res.status(403).json({ error: 'Undangan tidak lagi dapat diterima.' });
            // Update tenant_users status to 'active'
            await db.execute(
                "UPDATE tenant_users SET status = 'active' WHERE tenant_id = ? AND user_id = ?",
                [tenantId, userId]
            );
            // Update notification
            await db.execute(
                "UPDATE notifications SET is_read = 1, message = CONCAT(message, ' — Diterima.') WHERE id = ?",
                [notification_id]
            );
            console.log(`[INVITE] User ${userId} ACCEPTED invitation to tenant ${tenantId}`);
            res.json({ message: 'Undangan berhasil diterima. Anda sekarang anggota tenant ini.' });
        } else {
            // Reject: delete the tenant_users record
            await db.execute(
                "DELETE FROM tenant_users WHERE tenant_id = ? AND user_id = ? AND status = 'pending'",
                [tenantId, userId]
            );
            // Update notification
            await db.execute(
                "UPDATE notifications SET is_read = 1, message = CONCAT(message, ' — Ditolak.') WHERE id = ?",
                [notification_id]
            );
            console.log(`[INVITE] User ${userId} REJECTED invitation to tenant ${tenantId}`);
            res.json({ message: 'Undangan ditolak.' });
        }
    } catch (error) {
        logOperationalError('[API ERROR] Respond to notification:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Profile ---
app.get('/api/user/profile', async (req, res) => {
    try {
        const userId = req.user.userId;
        const tid = req.tenantContext?.tenantId || null;

        const [rows] = await db.execute('SELECT id, name, email, recipient_email, profile_picture_url FROM users WHERE id = ?', [userId]);
        if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
        
        const user = rows[0];

        res.json({
            ...user,
            tenant_id: tid,
            role: req.user.role
        });
    } catch (error) {
        logOperationalError('[PROFILE ERROR] Get profile:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.put('/api/user/profile', async (req, res) => {
    const { name, recipient_email } = req.body;
    const userId = req.user.userId;
    try {
        const finalRecipientEmail = (recipient_email && recipient_email.trim() !== '') ? recipient_email.trim() : null;
        await db.execute('UPDATE users SET name = ?, recipient_email = ? WHERE id = ?', [name, finalRecipientEmail, userId]);
        res.json({ message: 'Profil diperbarui' });
    } catch (error) {
        logOperationalError('[PROFILE ERROR] Update profile:', error);
        res.status(500).json({ error: 'Gagal memperbarui profil' });
    }
});

app.post('/api/user/upload-avatar', upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Tidak ada file yang diunggah' });
        const userId = req.user.userId;
        const tid = getTenantId(req);
        
        // Avatars go to tenant root (no folder hierarchy needed)
        const cdnPath = `tenant_${tid}`;
        
        // Synchronous CDN upload — await the full response (mirrors Media module)
        let cdnResponse;
        try {
            cdnResponse = await cdnService.upload(req.file.buffer, req.file.originalname, req.file.mimetype, cdnPath);
        } catch (cdnErr) {
            logOperationalError('[AVATAR] CDN upload failed:', cdnErr);
            return res.status(500).json({ error: 'Failed to upload avatar to CDN' });
        }

        const fileId = cdnResponse.fileId;
        if (!fileId) {
            console.error('[AVATAR] CDN returned no file identifier.');
            return res.status(500).json({ error: 'CDN returned no file identifier' });
        }

        // True Synchronous Await: Pause and wait for CDN processing to complete
        let cdnStatus = cdnResponse.status || 'processing';
        let rawUrl = cdnResponse.url || '';
        let attempts = 0;

        while (cdnStatus !== 'ready' && attempts < 15) {
            // Pause for 2 seconds
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
                const statusData = await cdnService.getStatus(fileId, req.file.mimetype);
                cdnStatus = statusData.status;
                if (cdnStatus === 'ready' && statusData.url) {
                    rawUrl = statusData.url;
                }
            } catch (err) {
                logOperationalError('[AVATAR] Error polling status:', err);
            }
            attempts++;
        }

        if (cdnStatus !== 'ready') {
            console.error('[AVATAR] ❌ Timed out waiting for CDN to process avatar.');
            return res.status(500).json({ error: 'Gagal memproses gambar di CDN (Timeout)' });
        }

        // Build the final Google Drive lh3 URL from the finalized CDN response
        let finalUrl = rawUrl;
        const driveIdMatch = rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/) || rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (driveIdMatch) {
            finalUrl = `https://lh3.googleusercontent.com/d/${driveIdMatch[1]}=w1200?authuser=0`;
        }
        
        // Failsafe: NEVER save "null" or empty string to database
        if (!finalUrl || finalUrl === 'null' || finalUrl === 'undefined') {
            console.error('[AVATAR] ❌ FAILSAFE: Resolved URL is null/empty, refusing to save.');
            return res.status(500).json({ error: 'CDN returned an invalid URL' });
        }

        await db.execute('UPDATE users SET profile_picture_url = ? WHERE id = ?', [finalUrl, userId]);
        console.log(`[AVATAR] ✅ User ${userId} avatar saved → ${finalUrl}`);
        return res.json({ url: finalUrl, status: 'ready' });
    } catch (error) {
        logOperationalError('[PROFILE ERROR] Upload avatar:', error);
        res.status(500).json({ error: 'Gagal mengunggah foto profil' });
    }
});

const profilePasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Terlalu banyak percobaan. Coba lagi nanti.' }
});
app.put('/api/user/change-password', profilePasswordLimiter, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
        return res.status(400).json({ error: 'Password baru harus berisi 12–128 karakter.' });
    }
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [users] = await connection.execute('SELECT password_hash FROM users WHERE id = ? FOR UPDATE', [userId]);
        if (users.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Pengguna tidak ditemukan' }); }
        
        const validPassword = await bcrypt.compare(currentPassword, users[0].password_hash);
        if (!validPassword) { await connection.rollback(); return res.status(400).json({ error: 'Kata sandi saat ini salah' }); }
        
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashedNewPassword, userId]);
        await bumpVersionIfAvailable(connection, userId);
        await connection.commit();
        res.json({ message: 'Kata sandi berhasil diubah. Silakan masuk kembali.' });
    } catch (error) {
        if (connection) await connection.rollback();
        logOperationalError('[PROFILE ERROR] Change password:', error);
        res.status(500).json({ error: 'Gagal mengubah kata sandi' });
    } finally {
        if (connection) connection.release();
    }
});

// --- Export ---
app.get('/api/export/zip', async (req, res) => {
    try {
        const tid = getTenantId(req);
        if (!tid) return res.status(400).json({ error: 'No tenant assignment found for current user.' });

        console.log(`[EXPORT] Initiating full project ZIP export for tenant: ${tid}`);

        const https = require('https');
        const http = require('http');
        const path = require('path');
        const fs = require('fs');

        const fetchImage = (url) => {
            return new Promise((resolve) => {
                if (!url) return resolve(null);
                const client = url.startsWith('https') ? https : http;
                client.get(url, (response) => {
                    if (response.statusCode === 200) {
                        const data = [];
                        response.on('data', (chunk) => data.push(chunk));
                        response.on('end', () => resolve(Buffer.concat(data)));
                    } else {
                        resolve(null);
                    }
                }).on('error', () => resolve(null));
            });
        };

        const archive = archiver('zip', { zlib: { level: 9 } });

        const downloadAndProcessImage = async (url) => {
            if (!url) return null;
            try {
                let filename = `image_${Date.now()}.png`;
                if (url.startsWith('http')) {
                    filename = path.basename(new URL(url).pathname);
                } else if (url.startsWith('/uploads') || url.startsWith('uploads/')) {
                    filename = path.basename(url);
                }
                if (!filename || filename === '') filename = `image_${Date.now()}.png`;

                let buffer = null;
                if (url.startsWith('http')) {
                    buffer = await fetchImage(url);
                } else {
                    const localPath = path.join(__dirname, 'uploads', filename);
                    if (fs.existsSync(localPath)) {
                        buffer = fs.readFileSync(localPath);
                    }
                }
                if (buffer) {
                    archive.append(buffer, { name: `public/assets/media/${filename}` });
                    return `./assets/media/${filename}`;
                }
            } catch (e) {
                logOperationalError('[EXPORT] Error processing image:', e);
            }
            return url;
        };

        // 1. Fetch data
        const [tenantRows] = await db.execute('SELECT name FROM tenants WHERE id = ?', [tid]);
        const tenantName = tenantRows[0]?.name || 'Site';

        const [settingsRows] = await db.execute('SELECT * FROM settings WHERE tenant_id = ?', [tid]);
        const [postsRows] = await db.execute("SELECT * FROM posts WHERE tenant_id = ? AND status = 'published'", [tid]);
        const [pagesRows] = await db.execute("SELECT * FROM pages WHERE tenant_id = ? AND status = 'published'", [tid]);

        if (settingsRows.length === 0) return res.status(404).json({ error: 'Settings not found.' });
        
        const settings = settingsRows[0];
        if (settings.global_options && typeof settings.global_options === 'string') {
            try { settings.global_options = JSON.parse(settings.global_options); } catch(e) {}
        }

        // Process Settings Logo
        if (settings.logo_url) {
            settings.logo_url = await downloadAndProcessImage(settings.logo_url) || settings.logo_url;
        }

        // Process pages and posts content
        const pages = [];
        for (const p of pagesRows) {
            if (p.content && typeof p.content === 'string') {
                try { p.content = JSON.parse(p.content); } catch(e) {}
            }
            if (p.content?.hero_image) {
                p.content.hero_image = await downloadAndProcessImage(p.content.hero_image) || p.content.hero_image;
            }
            if (p.content?.featured_image) {
                p.content.featured_image = await downloadAndProcessImage(p.content.featured_image) || p.content.featured_image;
            }
            if (p.content?.main_image) {
                p.content.main_image = await downloadAndProcessImage(p.content.main_image) || p.content.main_image;
            }
            pages.push(p);
        }

        const posts = [];
        for (const p of postsRows) {
            if (p.content && typeof p.content === 'string') {
                try { p.content = JSON.parse(p.content); } catch(e) {}
            }
            if (p.content?.featured_image) {
            p.content.featured_image = await downloadAndProcessImage(p.content.featured_image) || p.content.featured_image;
            }
            if (p.content?.main_image) {
                p.content.main_image = await downloadAndProcessImage(p.content.main_image) || p.content.main_image;
            }
            posts.push(p);
        }

        // 2. Prepare Headers
        const safeName = tenantName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
        res.setHeader('Content-Disposition', 'attachment; filename="' + safeName + '.zip"');

        // 3. Initialize Archiver
        archive.pipe(res);

        // --- Task 1: Generate Modular data/ ---
        const navPages = pages.map(p => ({ title: p.title, slug: p.slug }));
        const settingsData = {
            settings,
            navPages,
            exported_at: new Date().toISOString()
        };
        
        archive.append(JSON.stringify(settingsData, null, 2), { name: 'src/data/config/settings.json' });

        // Export each page
        pages.forEach(page => {
            archive.append(JSON.stringify(page, null, 2), { name: `src/data/pages/${page.slug}.json` });
        });

        // Export each post
        posts.forEach(post => {
            archive.append(JSON.stringify(post, null, 2), { name: `src/data/posts/${post.slug}.json` });
        });

        // Add a helper for posts metadata (for the blog list)
        const postsMetadata = posts.map(p => ({
            id: p.id,
            title: p.title,
            slug: p.slug,
            category: p.category,
            excerpt: p.excerpt,
            created_at: p.created_at
        }));
        archive.append(JSON.stringify(postsMetadata, null, 2), { name: 'src/data/config/posts.json' });

        // --- Task 2: Scaffolding Files ---
        const packageJson = {
            name: safeName.toLowerCase(),
            private: true,
            version: "1.0.0",
            type: "module",
            scripts: {
                "dev": "vite",
                "build": "vite build",
                "preview": "vite preview"
            },
            dependencies: {
                "react": "^18.2.0",
                "react-dom": "^18.2.0",
                "react-router-dom": "^6.22.3",
                "lucide-react": "^0.344.0",
                "framer-motion": "^11.0.8",
                "clsx": "^2.1.0",
                "tailwind-merge": "^2.2.1"
            },
            devDependencies: {
                "@types/react": "^18.2.66",
                "@types/react-dom": "^18.2.22",
                "@vitejs/plugin-react": "^4.2.1",
                "autoprefixer": "^10.4.18",
                "postcss": "^8.4.35",
                "tailwindcss": "^3.4.1",
                "typescript": "^5.2.2",
                "vite": "^5.2.2"
            }
        };
        archive.append(JSON.stringify(packageJson, null, 2), { name: 'package.json' });

        const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})`;
        archive.append(viteConfig, { name: 'vite.config.ts' });

        const readmeMd = `# ${settings.site_name}
        
## Local Development
1. \`npm install\`
2. \`npm run dev\`

## Hosting / Production
1. \`npm run build\`
2. Deploy the \`dist\` folder.
`;
        archive.append(readmeMd, { name: 'README.md' });

        const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${settings.site_name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
        archive.append(indexHtml, { name: 'index.html' });

        const mainTsx = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`;
        archive.append(mainTsx, { name: 'src/main.tsx' });

        const indexCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
}

body {
  margin: 0;
  display: flex;
  place-content: center;
  min-width: 320px;
  min-height: 100vh;
}

.rich-text-content {
  font-family: inherit;
}`;
        archive.append(indexCss, { name: 'src/index.css' });

        const appTsx = `import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import settingsData from './data/config/settings.json';
import postsList from './data/config/posts.json';
import Template from './templates/Template';

function PageLoader() {
  const { slug = 'home' } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setData(null);
    setError(false);
    
    import(\`./data/pages/\${slug}.json\`)
      .then(m => setData(m.default))
      .catch((err) => {
        logOperationalError('Failed to load page:', err);
        setError(true);
      });
  }, [slug]);

  if (error) return <Navigate to="/" replace />;
  if (!data) return <div className="flex items-center justify-center min-h-screen">Loading...</div>;

  const { settings, navPages } = settingsData;
  const themeColor = settings.global_options?.theme_color || '#fbbf24';
  const palette = settings.global_options?.branding_palette;

  return (
    <Template 
      pageData={data} 
      settings={settings} 
      posts={postsList} 
      themeColor={themeColor} 
      palette={palette} 
      navPages={navPages}
      currentSlug={slug}
    />
  );
}

function PostLoader() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setData(null);
    setError(false);
    
    import(\`./data/posts/\${slug}.json\`)
      .then(m => setData(m.default))
      .catch(() => setError(true));
  }, [slug]);

  if (error) return <Navigate to="/" replace />;
  if (!data) return <div className="flex items-center justify-center min-h-screen">Loading...</div>;

  const { settings, navPages } = settingsData;
  const themeColor = settings.global_options?.theme_color || '#fbbf24';
  const palette = settings.global_options?.branding_palette;

  return (
    <Template 
      pageData={{}} 
      postData={data}
      settings={settings} 
      posts={postsList} 
      themeColor={themeColor} 
      palette={palette} 
      navPages={navPages}
      currentSlug={slug}
    />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PageLoader />} />
        <Route path="/:slug" element={<PageLoader />} />
        <Route path="/post/:slug" element={<PostLoader />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}`;
        archive.append(appTsx, { name: 'src/App.tsx' });

        // --- Task 3: Template & Component Injection ---
        const activeTemplate = settings.active_template || 'minimalist';
        const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
        
        let templatePath = '';
        const possiblePaths = [
            path.join(__dirname, '..', 'src', 'templates', activeTemplate, `${capitalize(activeTemplate)}Template.tsx`),
            path.join(__dirname, '..', 'src', 'templates', `${capitalize(activeTemplate)}Template.tsx`)
        ];

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                templatePath = p;
                break;
            }
        }

        if (templatePath) {
            let templateContent = fs.readFileSync(templatePath, 'utf8');
            // Fix imports if depth changed
            if (templatePath.includes(`${path.sep}${activeTemplate}${path.sep}`)) {
                templateContent = templateContent.split('../../../components/').join('../components/');
            }
            archive.append(templateContent, { name: 'src/templates/Template.tsx' });
        } else {
            console.error(`[EXPORT] Template not found for: ${activeTemplate}`);
            // Fallback to a dummy or error page if template missing?
        }

        const componentPath = path.join(__dirname, '..', 'src', 'components', 'UnifiedPostLayout.tsx');
        if (fs.existsSync(componentPath)) {
            const componentContent = fs.readFileSync(componentPath, 'utf8');
            archive.append(componentContent, { name: 'src/components/UnifiedPostLayout.tsx' });
        }

        // Finalize
        await archive.finalize();
        console.log(`[EXPORT] ZIP export completed for tenant: ${tid}`);

    } catch (error) {
        logOperationalError('[EXPORT ERROR]:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Export failed' });
        }
    }
});



// --- Plugins ---
app.get('/api/plugins', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const [rows] = await db.execute('SELECT * FROM plugins WHERE tenant_id = ?', [tid]);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.put('/api/plugins/:id', async (req, res) => {
    const { is_active } = req.body;
    const { id } = req.params;
    const tid = getTenantId(req);
    try {
        await db.execute(
            'UPDATE plugins SET is_active = ? WHERE id = ? AND tenant_id = ?',
            [is_active, id, tid]
        );
        res.json({ message: 'Plugin updated successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// ★ CONTACT INQUIRIES MANAGEMENT (Protected — JWT required) ★
// =============================================================

// GET /api/inquiries — List all inquiries for the tenant
app.get('/api/inquiries', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const [rows] = await db.execute(
            'SELECT * FROM contact_inquiries WHERE tenant_id = ? ORDER BY created_at DESC',
            [tid]
        );
        res.json(rows);
    } catch (error) {
        logOperationalError('[API ERROR] Get inquiries:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /api/inquiries/count — Unread count for sidebar badge
app.get('/api/inquiries/count', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const [rows] = await db.execute(
            "SELECT COUNT(*) as unread FROM contact_inquiries WHERE tenant_id = ? AND status = 'unread'",
            [tid]
        );
        res.json({ unread: rows[0].unread });
    } catch (error) {
        logOperationalError('[API ERROR] Get inquiry count:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PATCH /api/inquiries/:id/read — Mark as read
app.patch('/api/inquiries/:id/read', async (req, res) => {
    try {
        const tid = getTenantId(req);
        await db.execute(
            "UPDATE contact_inquiries SET status = 'read' WHERE id = ? AND tenant_id = ?",
            [req.params.id, tid]
        );
        res.json({ success: true });
    } catch (error) {
        logOperationalError('[API ERROR] Mark inquiry read:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// DELETE /api/inquiries/:id — Delete a single inquiry
app.delete('/api/inquiries/:id', async (req, res) => {
    try {
        const tid = getTenantId(req);
        await db.execute(
            'DELETE FROM contact_inquiries WHERE id = ? AND tenant_id = ?',
            [req.params.id, tid]
        );
        res.json({ success: true });
    } catch (error) {
        logOperationalError('[API ERROR] Delete inquiry:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/inquiries/bulk-delete — Delete multiple inquiries
app.post('/api/inquiries/bulk-delete', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array is required.' });
        }
        const placeholders = ids.map(() => '?').join(',');
        await db.execute(
            `DELETE FROM contact_inquiries WHERE id IN (${placeholders}) AND tenant_id = ?`,
            [...ids, tid]
        );
        res.json({ success: true, deleted: ids.length });
    } catch (error) {
        logOperationalError('[API ERROR] Bulk delete inquiries:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// ★ COMMENTS MANAGEMENT (Protected — JWT required) ★
// =============================================================

// GET /api/comments — List all comments for the tenant (with post title JOIN)
app.get('/api/comments', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const { search, status } = req.query;

        let query = `
            SELECT c.*, p.title as post_title
            FROM comments c
            LEFT JOIN posts p ON c.post_id = p.id
            WHERE c.tenant_id = ?
        `;
        const params = [tid];

        if (status && status !== 'all') {
            query += ' AND c.status = ?';
            params.push(status);
        }

        if (search) {
            query += ' AND (c.author_name LIKE ? OR c.author_email LIKE ? OR c.content LIKE ?)';
            const searchWildcard = `%${search}%`;
            params.push(searchWildcard, searchWildcard, searchWildcard);
        }

        query += ' ORDER BY c.created_at DESC';

        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (error) {
        logOperationalError('[API ERROR] Get comments:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /api/comments/count — Pending count for sidebar badge
app.get('/api/comments/count', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const [rows] = await db.execute(
            "SELECT COUNT(*) as pending FROM comments WHERE tenant_id = ? AND status = 'pending'",
            [tid]
        );
        res.json({ pending: rows[0].pending });
    } catch (error) {
        logOperationalError('[API ERROR] Get comment count:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PATCH /api/comments/:id/status — Update comment status (approved, pending, spam)
app.patch('/api/comments/:id/status', async (req, res) => {
    try {
        const tid = getTenantId(req);
        const { status } = req.body;
        const validStatuses = ['pending', 'approved', 'spam'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }
        await db.execute(
            'UPDATE comments SET status = ? WHERE id = ? AND tenant_id = ?',
            [status, req.params.id, tid]
        );
        res.json({ success: true, status });
    } catch (error) {
        logOperationalError('[API ERROR] Update comment status:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// DELETE /api/comments/:id — Permanently delete a comment
app.delete('/api/comments/:id', async (req, res) => {
    try {
        const tid = getTenantId(req);
        await db.execute(
            'DELETE FROM comments WHERE id = ? AND tenant_id = ?',
            [req.params.id, tid]
        );
        res.json({ success: true });
    } catch (error) {
        logOperationalError('[API ERROR] Delete comment:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Catch-All for 404
app.use((req, res) => {
    console.log('404 Route Not Found:', req.url);
    res.status(404).send('Route not found');
});

if (require.main === module) {
    const PORT = process.env.PORT || 8080;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
