const crypto = require('crypto');
const { SUPER_ADMIN_EMAIL } = require('../config/superAdmin');

const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

async function hasGlobalSuperAdminRole(database, userId, email) {
    if (normalizeEmail(email) !== SUPER_ADMIN_EMAIL) return false;
    const [roles] = await database.execute(
        "SELECT 1 FROM user_global_roles WHERE user_id = ? AND role = 'super_admin' LIMIT 1",
        [userId]
    );
    return roles.length > 0;
}

function credentialVersion(passwordHash, secret) {
    return crypto.createHmac('sha256', secret).update(passwordHash).digest('hex');
}

function verificationCodeHash(email, purpose, code, secret) {
    return crypto.createHmac('sha256', secret)
        .update(`${normalizeEmail(email)}:${purpose}:${code}`)
        .digest('hex');
}

function constantTimeHexEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string' || !/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
    return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

module.exports = { normalizeEmail, hasGlobalSuperAdminRole, credentialVersion, verificationCodeHash, constantTimeHexEqual };
