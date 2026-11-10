const db = require('../server/lib/db');

async function logActivity(tenantId, userId, actorName, actorRole, action, status) {
    try {
        if (!tenantId) return;

        await db.execute(
            'INSERT INTO activity_logs (tenant_id, user_id, actor_name, actor_role, action, status) VALUES (?, ?, ?, ?, ?, ?)',
            [tenantId, userId, actorName, actorRole, action, status]
        );
    } catch (error) {
        console.error('[LOGGER ERROR] Failed to insert activity log:', error);
    }
}

module.exports = { logActivity };
