const VALID_ROLES = new Set(['admin', 'co_admin', 'content_creative', 'guest']);

const PERMISSIONS = {
    super_admin: new Set(['read', 'content', 'settings', 'api_keys', 'members', 'assign_admin', 'remove_admin']),
    admin: new Set(['read', 'content', 'settings', 'api_keys', 'members', 'assign_admin', 'remove_admin']),
    co_admin: new Set(['read', 'content', 'settings', 'api_keys', 'members']),
    content_creative: new Set(['read', 'content']),
    guest: new Set(['read'])
};

function parseTenantId(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
}

function can(role, permission) {
    return PERMISSIONS[role]?.has(permission) === true;
}

async function resolveTenantContext(database, tenantId, userId, isSuperAdmin = false) {
    const id = parseTenantId(tenantId);
    if (!id) return null;
    const [tenants] = await database.execute('SELECT id, status FROM tenants WHERE id = ? LIMIT 1', [id]);
    if (!tenants.length) return null;

    if (isSuperAdmin) {
        return { tenantId: id, role: 'super_admin', status: tenants[0].status, elevated: true };
    }
    if (tenants[0].status !== 'active') return null;

    const [memberships] = await database.execute(
        "SELECT role FROM tenant_users WHERE tenant_id = ? AND user_id = ? AND status = 'active' LIMIT 1",
        [id, userId]
    );
    if (!memberships.length) return null;
    const role = VALID_ROLES.has(memberships[0].role) ? memberships[0].role : 'guest';
    return { tenantId: id, role, status: tenants[0].status, elevated: false };
}

module.exports = { parseTenantId, can, resolveTenantContext };
