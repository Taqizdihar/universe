const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const routeStart = source.indexOf("app.put('/api/v1/superadmin/tenants/:tenantId/admins/:adminId/password'");
const routeEnd = source.indexOf("app.patch('/api/v1/superadmin/tenants/:id/status'", routeStart);
assert.ok(routeStart > 0 && routeEnd > routeStart);

function createRoute({ adminFound = true, targetIsSuperAdmin = false } = {}) {
    const calls = [];
    const authenticateToken = () => {};
    const verifySuperAdmin = () => {};
    let registration;
    const db = {
        async execute(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('SELECT u.id, u.email')) {
                assert.match(sql, /tu\.role = 'admin'/);
                assert.match(sql, /tu\.status = 'active'/);
                assert.deepEqual([...params], [7, 42]);
                return [adminFound ? [{ id: 42, email: 'admin@example.com' }] : []];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        },
        async getConnection() { return {
            async beginTransaction() { calls.push({ tx: 'begin' }); },
            async execute(sql, params) {
                calls.push({ sql, params });
                if (sql.startsWith('SELECT id FROM users')) return [[{ id: 42 }]];
                if (sql.startsWith('UPDATE users SET password_hash')) return [{ affectedRows: 1 }];
                throw new Error(`Unexpected transaction SQL: ${sql}`);
            },
            async commit() { calls.push({ tx: 'commit' }); },
            async rollback() { calls.push({ tx: 'rollback' }); },
            release() {}
        }; }
    };
    const context = {
        app: { put(...args) { registration = args; } },
        authenticateToken,
        verifySuperAdmin,
        hasGlobalSuperAdminRole: async () => targetIsSuperAdmin,
        db,
        bcrypt: { async hash(password, rounds) {
            calls.push({ password, rounds });
            return 'hashed-password';
        } },
        bumpVersionIfAvailable: async (_connection, userId) => { calls.push({ bump: userId }); },
        logActivity(...args) { calls.push({ audit: [...args] }); },
        console
    };
    vm.runInNewContext(source.slice(routeStart, routeEnd), context);
    assert.equal(registration[0], '/api/v1/superadmin/tenants/:tenantId/admins/:adminId/password');
    assert.equal(registration[1], authenticateToken);
    assert.equal(registration[2], verifySuperAdmin);
    return { handler: registration[3], calls };
}

async function request(handler, body, params = { tenantId: '7', adminId: '42' }) {
    const result = { statusCode: 200 };
    const res = {
        status(code) { result.statusCode = code; return this; },
        json(data) { result.body = data; return this; }
    };
    await handler({ params, body, user: { userId: 1, name: 'Super Admin' } }, res);
    return result;
}

test('emergency reset validates target and matching password before accessing the database', async () => {
    const { handler, calls } = createRoute();
    const password = 'CorrectHorse123!';
    for (const [body, params] of [
        [{ newPassword: password, confirmPassword: password }, { tenantId: '7x', adminId: '42' }],
        [{ newPassword: 'short', confirmPassword: 'short' }, { tenantId: '7', adminId: '42' }],
        [{ newPassword: password, confirmPassword: 'different' }, { tenantId: '7', adminId: '42' }],
        [{ newPassword: password, confirmPassword: password }, { tenantId: '7', adminId: '1' }]
    ]) {
        assert.equal((await request(handler, body, params)).statusCode, 400);
    }
    assert.equal(calls.length, 0);
});

test('emergency reset refuses accounts without an active admin membership in the tenant', async () => {
    const { handler, calls } = createRoute({ adminFound: false });
    const response = await request(handler, { newPassword: 'CorrectHorse123!', confirmPassword: 'CorrectHorse123!' });
    assert.equal(response.statusCode, 404);
    assert.equal(calls.length, 1);
});

test('emergency reset cannot change the global super admin password', async () => {
    const { handler, calls } = createRoute({ targetIsSuperAdmin: true });
    const response = await request(handler, { newPassword: 'CorrectHorse123!', confirmPassword: 'CorrectHorse123!' });
    assert.equal(response.statusCode, 403);
    assert.equal(calls.length, 1);
});

test('emergency reset stores only a hash for the selected admin and records an audit event', async () => {
    const { handler, calls } = createRoute();
    const response = await request(handler, { newPassword: 'CorrectHorse123!', confirmPassword: 'CorrectHorse123!' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual([...calls.find(call => call.sql?.startsWith('UPDATE users SET password_hash')).params], ['hashed-password', 42]);
    assert.equal(calls[1].rounds, 10);
    assert.equal(calls.find(call => call.bump).bump, 42);
    assert.equal(calls.find(call => call.audit).audit[0], 7);
    assert.equal(calls.find(call => call.audit).audit[1], 1);
    assert.doesNotMatch(JSON.stringify(response), /CorrectHorse123/);
});
