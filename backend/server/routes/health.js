// =============================================================
// Health Check Route — GET /api/v1/health
// =============================================================
// Returns server and database connectivity status.
// Used by monitoring tools, load balancers, and CI/CD pipelines
// to confirm the service is alive and the DB is reachable.
// =============================================================

const express = require('express');
const router = express.Router();
const db = require('../lib/db');

router.get('/', async (req, res) => {
    const healthStatus = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: 'UNI-VERSE Headless CMS API',
        database: 'UNKNOWN'
    };

    try {
        // Attempt a lightweight query to verify DB connectivity
        const [rows] = await db.execute('SELECT 1 AS alive');
        if (rows && rows[0] && rows[0].alive === 1) {
            healthStatus.database = 'CONNECTED';
        }
    } catch (error) {
        healthStatus.status = 'DEGRADED';
        healthStatus.database = 'DISCONNECTED';
        console.error('[HEALTH] Database check failed:', error.code || 'UNKNOWN');
        return res.status(503).json(healthStatus);
    }

    res.status(200).json(healthStatus);
});

module.exports = router;
