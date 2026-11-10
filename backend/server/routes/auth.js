// =============================================================
// Auth & API Key Routes
// =============================================================
// Centralizes all authentication-related logic:
//   • apiAuth middleware  — x-api-key validation for public routes
//   • GET  /api-key       — Retrieve the tenant's current API key
//   • POST /api-key/regenerate — Generate a fresh API key
//
// The router expects JWT authenticateToken to be applied
// externally (via app.use('/api', authenticateToken) in server.js).
// =============================================================

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../lib/db');

// =============================================================
// Middleware: apiAuth — Public API Key Validation
// =============================================================
// Validates the x-api-key header against the api_keys table.
// On success, sets req.publicTenantId for downstream handlers.
// Used by data.js to protect public content delivery endpoints.
// =============================================================

const apiAuth = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({ error: 'x-api-key header is missing' });
    }

    try {
        const [keys] = await db.execute(
            "SELECT ak.tenant_id FROM api_keys ak JOIN tenants t ON t.id = ak.tenant_id AND t.status = 'active' WHERE ak.api_key = ? LIMIT 1",
            [apiKey]
        );
        
        if (keys.length === 0) {
            return res.status(401).json({ error: 'Invalid API Key' });
        }

        req.api_tenant_id = keys[0].tenant_id;
        next();
    } catch (error) {
        console.error('[API AUTH ERROR]:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// =============================================================
// GET /api-key — Retrieve API Key for authenticated tenant
// =============================================================
// Auto-generates a key if none exists (backward compat for
// tenants created before the api_keys table was introduced).
// =============================================================

router.get('/api-key', async (req, res) => {
    try {
        const tid = req.tenantContext.tenantId;
        const [keys] = await db.execute('SELECT api_key FROM api_keys WHERE tenant_id = ? LIMIT 1', [tid]);
        
        if (keys.length === 0) {
            return res.status(404).json({ error: 'No API Key found for this workspace. Please generate one.' });
        }
        res.json({ api_key: keys[0].api_key });
    } catch (error) {
        console.error('[API ERROR] Get API Key:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =============================================================
// POST /api-key/regenerate — Generate a fresh API Key
// =============================================================
// Replaces the existing key (UPDATE) or creates one (INSERT)
// if the tenant somehow lost their record.
// =============================================================

router.post('/api-key/regenerate', async (req, res) => {
    try {
        const tid = req.tenantContext.tenantId;
        const newKey = 'uni_' + crypto.randomBytes(24).toString('hex');
        
        const [keys] = await db.execute('SELECT id FROM api_keys WHERE tenant_id = ?', [tid]);
        if (keys.length > 0) {
            await db.execute('UPDATE api_keys SET api_key = ? WHERE tenant_id = ?', [newKey, tid]);
        } else {
            await db.execute('INSERT INTO api_keys (tenant_id, api_key) VALUES (?, ?)', [tid, newKey]);
        }
        
        res.json({ api_key: newKey });
    } catch (error) {
        console.error('[API ERROR] Regenerate API Key:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = { router, apiAuth };
