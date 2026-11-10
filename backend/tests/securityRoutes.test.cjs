const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { credentialVersion } = require('../utils/superAdminAuth');

const secret = 'isolated-tests-only-secret-with-thirty-two-bytes';
process.env.JWT_SECRET = secret;
process.env.FRONTEND_URL = 'https://cms.example.test';

const tenants = [
    { id: 1, subdomain: 'alpha', status: 'active' },
    { id: 2, subdomain: 'beta', status: 'active' },
    { id: 3, subdomain: 'paused', status: 'suspended' }
];
const users = [
    { id: 101, email: 'admin@alpha.test', name: 'Admin A', password_hash: 'hash' },
    { id: 102, email: 'manager@beta.test', name: 'Manager B', password_hash: 'hash' },
    { id: 103, email: 'editor@alpha.test', name: 'Editor A', password_hash: 'hash' },
    { id: 104, email: 'guest@alpha.test', name: 'Guest A', password_hash: 'hash' },
    { id: 105, email: 'm.taqizdihar@gmail.com', name: 'Super Admin', password_hash: 'hash' }
];
const memberships = [
    { tenant_id: 1, user_id: 101, role: 'admin', status: 'active' },
    { tenant_id: 3, user_id: 101, role: 'admin', status: 'active' },
    { tenant_id: 1, user_id: 102, role: 'co_admin', status: 'active' },
    { tenant_id: 2, user_id: 102, role: 'admin', status: 'active' },
    { tenant_id: 1, user_id: 103, role: 'content_creative', status: 'active' },
    { tenant_id: 1, user_id: 104, role: 'guest', status: 'active' }
];
const keys = new Map([[1, 'fixture-key-alpha'], [2, 'fixture-key-beta'], [3, 'fixture-key-paused']]);
const pages = [
    { id: 1, tenant_id: 1, slug: 'home', title: 'Published A', status: 'published', content: '[]' },
    { id: 2, tenant_id: 1, slug: 'private-page', title: 'Draft A', status: 'draft', content: '[]' },
    { id: 3, tenant_id: 2, slug: 'home', title: 'Published B', status: 'published', content: '[]' }
];
const posts = [
    { id: 1, tenant_id: 1, slug: 'news', title: 'Published post', status: 'published', content: '[]', excerpt: 'Hello' },
    { id: 2, tenant_id: 1, slug: 'secret-post', title: 'Draft post', status: 'draft', content: '[]' }
];
const sqlLog = [];
const mockDb = {
    async execute(sql, params = []) {
        sqlLog.push({ sql, params });
        const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (q.startsWith('select name, email, password_hash from users where id'))
            return [users.filter(u => u.id === params[0])];
        if (q.startsWith('select id, name, email, profile_picture_url, password_hash from users where email'))
            return [users.filter(u => u.email === params[0])];
        if (q.startsWith('select name, email, profile_picture_url from users where id'))
            return [users.filter(u => u.id === params[0])];
        if (q.includes('from user_global_roles')) return [params[0] === 105 ? [{ '1': 1 }] : []];
        if (q.startsWith('select id, status from tenants where id'))
            return [tenants.filter(t => t.id === params[0])];
        if (q.startsWith('select role from tenant_users where tenant_id'))
            return [memberships.filter(m => m.tenant_id === params[0] && m.user_id === params[1] && m.status === 'active')];
        if (q.startsWith('select * from notifications where id'))
            return [params[0] === 1 && params[1] === 101 ? [{ id: 1, tenant_id: 1, user_id: 101, type: 'invitation' }] : []];
        if (q.startsWith('select user_id from tenant_users where tenant_id') && q.includes("status = 'pending'"))
            return [memberships.filter(m => m.tenant_id === params[0] && m.user_id === params[1] && m.status === 'pending')];
        if (q.startsWith('select api_key from api_keys where tenant_id'))
            return [keys.has(params[0]) ? [{ api_key: keys.get(params[0]) }] : []];
        if (q.startsWith('select id from api_keys where tenant_id'))
            return [keys.has(params[0]) ? [{ id: params[0] }] : []];
        if (q.startsWith('update api_keys set api_key')) { keys.set(params[1], params[0]); return [{ affectedRows: 1 }]; }
        if (q.startsWith('select site_name from settings where tenant_id'))
            return [[{ site_name: `Tenant ${params[0]}` }]];
        if (q.includes('from tenants t') && q.includes('left join tenant_users tu'))
            return [tenants.map(t => ({ tenant_id: t.id, subdomain: t.subdomain, status: t.status }))];
        if (q.startsWith('select tu.tenant_id from tenant_users tu join tenants t'))
            return [memberships.filter(m => m.user_id === params[0] && m.role === 'admin' && m.status === 'active' && tenants.find(t => t.id === m.tenant_id)?.status === 'active').map(m => ({ tenant_id: m.tenant_id }))];
        if (q.startsWith('select id from tenants where subdomain'))
            return [tenants.filter(t => t.subdomain === params[0] && t.status === 'active').map(t => ({ id: t.id }))];
        if (q.includes('from pages p') && q.includes('where p.slug'))
            return [pages.filter(p => p.slug === params[0] && p.tenant_id === params[1] && p.status === 'published')];
        if (q.includes('from posts p') && q.includes('where p.slug'))
            return [posts.filter(p => p.slug === params[0] && p.tenant_id === params[1] && p.status === 'published')];
        if (q.startsWith('select title, slug from pages where tenant_id'))
            return [pages.filter(p => p.tenant_id === params[0] && p.status === 'published').map(({ title, slug }) => ({ title, slug }))];
        if (q.includes('from api_keys ak join tenants t'))
            return [[...keys].filter(([id, key]) => key === params[0] && tenants.find(t => t.id === id)?.status === 'active').map(([tenant_id]) => ({ tenant_id }))];
        if (q.includes('from posts') && q.includes("posts.status = 'published'"))
            return [posts.filter(p => p.tenant_id === params[0] && p.status === 'published')];
        if (q.startsWith('select * from pages where tenant_id') && q.includes("status = 'published'"))
            return [pages.filter(p => p.tenant_id === params[0] && p.status === 'published' && (params[1] === undefined || p.slug === params[1]))];
        if (q.includes('from pages') && q.includes("pages.status = 'published'"))
            return [pages.filter(p => p.tenant_id === params[0] && p.status === 'published')];
        if (q.startsWith('update settings set')) return [{ affectedRows: 1 }];
        if (q.startsWith('insert into activity_logs')) return [{ affectedRows: 1 }];
        if (q.startsWith('select id from post_categories')) return [[]];
        if (q.startsWith('select id from media_folders')) return [[]];
        throw new Error(`Unmocked SQL: ${q}`);
    },
    async getConnection() {
        return {
            execute: async (sql, params) => {
                const q = sql.toLowerCase();
                if (q.includes('select role, status from tenant_users')) return [memberships.filter(m => m.tenant_id === params[0] && m.user_id === params[1])];
                if (q.includes('select user_id from tenant_users')) return [memberships.filter(m => m.tenant_id === params[0] && m.role === 'admin' && m.status === 'active')];
                if (q.startsWith('delete from tenant_users')) return [{ affectedRows: 1 }];
                throw new Error(`Unmocked transaction SQL: ${q}`);
            },
            async beginTransaction() {}, async rollback() {}, async commit() {}, release() {}
        };
    }
};

const dbPath = require.resolve('../server/lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: mockDb };
const app = require('../server');
let server, base;
before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

const token = (userId, tenantId, overrides = {}) => jwt.sign({ userId, tenant_id: tenantId, role: 'admin', ...overrides }, secret);
async function request(route, { method = 'GET', userId, tenantId, activeTenant, body, origin, apiKey, bearer } = {}) {
    const headers = {};
    if (userId) headers.authorization = `Bearer ${bearer || token(userId, tenantId)}`;
    if (activeTenant !== undefined) headers['x-active-tenant'] = String(activeTenant);
    if (origin) headers.origin = origin;
    if (apiKey) headers['x-api-key'] = apiKey;
    if (body) headers['content-type'] = 'application/json';
    const response = await fetch(base + route, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
}

test('JWT, tenant headers and persisted membership isolate API keys', async () => {
    assert.equal((await request('/api/settings/api-key')).status, 401);
    assert.equal((await request('/api/settings/api-key', { userId: 101, tenantId: 1, bearer: 'invalid' })).status, 403);
    assert.equal((await request('/api/settings/api-key', { userId: 101, tenantId: 1 })).body.api_key, 'fixture-key-alpha');
    assert.equal((await request('/api/settings/api-key', { userId: 101, tenantId: 1, activeTenant: 2 })).status, 403);
    assert.equal((await request('/api/settings/api-key', { userId: 101, tenantId: 2 })).status, 403);
    assert.equal((await request('/api/settings/api-key', { userId: 101, tenantId: 1, activeTenant: '2oops' })).status, 400);
    assert.equal((await request('/api/settings/api-key', { userId: 102, tenantId: 1 })).body.api_key, 'fixture-key-alpha');
    assert.equal((await request('/api/settings/api-key', { userId: 102, tenantId: 1, activeTenant: 2 })).body.api_key, 'fixture-key-beta');
    const beforeKey = keys.get(2);
    assert.equal((await request('/api/settings/api-key/regenerate', { method: 'POST', userId: 101, tenantId: 1, activeTenant: 2 })).status, 403);
    assert.equal(keys.get(2), beforeKey);
    const regenerated = await request('/api/settings/api-key/regenerate', { method: 'POST', userId: 101, tenantId: 1 });
    assert.equal(regenerated.status, 200);
    assert.match(regenerated.body.api_key, /^uni_[0-9a-f]{48}$/);
    assert.equal(keys.get(1), regenerated.body.api_key);
    keys.set(1, 'fixture-key-alpha');
});

test('settings and member operations reject cross-tenant targets and privilege escalation', async () => {
    const settings = { site_name: 'Compromised' };
    const beforeQueries = sqlLog.length;
    assert.equal((await request('/api/site-settings/2', { method: 'PUT', userId: 101, tenantId: 1, body: settings })).status, 403);
    assert.equal(sqlLog.slice(beforeQueries).some(x => x.sql.startsWith('UPDATE settings')), false);
    assert.equal((await request('/api/site-settings/1', { method: 'PUT', userId: 101, tenantId: 1, body: settings })).status, 200);
    assert.equal((await request('/api/site-settings/1', { method: 'PUT', userId: 104, tenantId: 1, body: settings })).status, 403);
    assert.equal((await request('/api/users/102', { method: 'DELETE', userId: 103, tenantId: 1 })).status, 403);
    assert.equal((await request('/api/users/102', { method: 'DELETE', userId: 101, tenantId: 1, activeTenant: 2 })).status, 403);
    assert.equal((await request('/api/users/101', { method: 'DELETE', userId: 102, tenantId: 1 })).status, 403);
    assert.equal((await request('/api/users/101', { method: 'DELETE', userId: 101, tenantId: 1 })).status, 409);
    assert.equal((await request('/api/tenant/invite', { method: 'POST', userId: 102, tenantId: 1, body: { email: 'guest@alpha.test', role: 'admin' } })).status, 403);
    const beforeReject = sqlLog.length;
    assert.equal((await request('/api/notifications/respond', { method: 'POST', userId: 101, tenantId: 1, body: { notification_id: 1, action: 'reject' } })).status, 409);
    assert.equal(sqlLog.slice(beforeReject).some(x => x.sql.startsWith('DELETE FROM tenant_users')), false);
    assert.equal((await request('/api/settings/api-key', { userId: 103, tenantId: 1 })).status, 403);
    assert.equal((await request('/api/settings/api-key', { userId: 104, tenantId: 1 })).status, 403);
    assert.equal((await request('/api/posts', { method: 'POST', userId: 104, tenantId: 1, body: { title: 'Unauthorized' } })).status, 403);
    assert.equal((await request('/api/posts', { method: 'POST', userId: 101, tenantId: 1, body: { title: 'Invalid category', category_id: 42 } })).status, 400);
    assert.equal((await request('/api/folders', { method: 'POST', userId: 101, tenantId: 1, body: { name: 'Wrong parent', parent_id: 42 } })).status, 404);
});

test('active workspaces switch; suspension invalidates existing tenant context', async () => {
    const switched = await request('/api/auth/switch-workspace', { method: 'POST', userId: 102, tenantId: 1, body: { tenant_id: 2 } });
    assert.equal(switched.status, 200);
    assert.equal(switched.body.tenant_id, 2);
    assert.equal((await request('/api/settings/api-key', { userId: 102, tenantId: 2, bearer: switched.body.token })).body.api_key, 'fixture-key-beta');
    assert.equal((await request('/api/auth/switch-workspace', { method: 'POST', userId: 101, tenantId: 1, body: { tenant_id: 2 } })).status, 403);
    assert.equal((await request('/api/settings/api-key', { userId: 101, tenantId: 3 })).status, 403);
    assert.equal((await request('/api/auth/switch-workspace', { method: 'POST', userId: 101, tenantId: 1, body: { tenant_id: 3 } })).status, 403);
});

test('public site and API-key feeds return published content only', async () => {
    const page = await request('/api/public/site/alpha/home');
    assert.equal(page.status, 200);
    assert.equal(page.body.page.title, 'Published A');
    assert.equal((await request('/api/public/site/alpha/news')).body.type, 'post');
    for (const url of ['/api/public/site/alpha/private-page', '/api/public/site/alpha/secret-post', '/api/public/site/beta/news', '/api/public/site/paused/home', '/api/public/site/alpha/bad.slug'])
        assert.equal((await request(url)).status, 404, url);
    assert.equal((await request('/api/v1/public/posts', { apiKey: 'wrong' })).status, 401);
    const feed = await request('/api/v1/public/posts', { apiKey: 'fixture-key-alpha' });
    assert.equal(feed.status, 200);
    assert.deepEqual(feed.body.map(p => p.slug), ['news']);
    const pageFeed = await request('/api/v1/public/pages', { apiKey: 'fixture-key-alpha' });
    assert.equal(pageFeed.status, 200);
    assert.deepEqual(pageFeed.body.map(p => p.slug), ['home']);
    assert.equal((await request('/api/v1/public/pages/private-page', { apiKey: 'fixture-key-alpha' })).status, 404);
    assert.equal((await request('/api/v1/public/posts', { apiKey: 'fixture-key-paused' })).status, 401);
});

test('public JSON strips executable HTML while preserving ordinary rich text', async () => {
    pages.push({ id: 4, tenant_id: 1, slug: 'unsafe', title: 'Unsafe', status: 'published', content: JSON.stringify({
        body: '<p onclick="alert(1)">Hello <strong>world</strong></p><script>alert(2)</script>',
        button_link: 'javascript:alert(3)'
    }) });
    try {
        const site = await request('/api/public/site/alpha/unsafe');
        assert.equal(site.status, 200);
        assert.equal(site.body.page.content.body, '<p>Hello <strong>world</strong></p>');
        assert.equal(site.body.page.content.button_link, '');
        const feed = await request('/api/v1/public/pages', { apiKey: 'fixture-key-alpha' });
        const page = feed.body.find(item => item.slug === 'unsafe');
        assert.equal(page.content.body, '<p>Hello <strong>world</strong></p>');
    } finally {
        pages.pop();
    }
});

test('private CORS rejects untrusted origins and never sets credentialed wildcard', async () => {
    const denied = await request('/api/settings/api-key', { userId: 101, tenantId: 1, origin: 'https://attacker.test' });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    const allowed = await request('/api/settings/api-key', { userId: 101, tenantId: 1, origin: 'https://cms.example.test' });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://cms.example.test');
    assert.equal(allowed.headers.get('access-control-allow-credentials'), null);
    const publicResponse = await request('/api/public/site/alpha/home', { origin: 'https://landing.example.test' });
    assert.equal(publicResponse.headers.get('access-control-allow-origin'), '*');
    assert.equal(publicResponse.headers.get('access-control-allow-credentials'), null);
});

test('Super Admin routes require persisted global role and credential version', async () => {
    const route = '/api/v1/superadmin/tenants';
    assert.equal((await request(route, { userId: 101, tenantId: 1, bearer: token(101, 1, { role: 'super_admin' }) })).status, 403);
    assert.equal((await request(route, { userId: 105, tenantId: null, bearer: token(105, null, { credential_version: 'forged' }) })).status, 401);
    const valid = token(105, null, { credential_version: credentialVersion('hash', secret) });
    assert.equal((await request(route, { userId: 105, tenantId: null, bearer: valid })).status, 200);
    const auditStart = sqlLog.length;
    assert.equal((await request('/api/settings/api-key', { userId: 105, tenantId: null, bearer: valid, activeTenant: 2 })).body.api_key, keys.get(2));
    assert.equal(sqlLog.slice(auditStart).some(x => x.sql.includes('INSERT INTO activity_logs') && x.params[0] === 2 && x.params[3] === 'super_admin'), true);
});

test('login limiter blocks repeated guesses and missing JWT configuration fails closed', async () => {
    let last;
    for (let i = 0; i < 21; i++) last = await request('/api/auth/login', { method: 'POST', body: { email: 'absent@example.test', password: 'wrong' } });
    assert.equal(last.status, 429);
    const result = spawnSync(process.execPath, ['-e', "delete process.env.JWT_SECRET; require('./server.js')"], {
        cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: '' }, encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JWT_SECRET must be configured/);
});

test('authentication and API key requests do not print credentials or keys', async () => {
    const lines = [];
    const originalLog = console.log;
    try {
        console.log = (...parts) => lines.push(parts.join(' '));
        await request('/api/settings/api-key', { userId: 101, tenantId: 1 });
        await request('/api/auth/login', { method: 'POST', body: { email: 'private@example.test', password: 'private-password' } });
    } finally {
        console.log = originalLog;
    }
    const output = lines.join('\n');
    for (const secretValue of ['fixture-key-alpha', 'private@example.test', 'private-password'])
        assert.equal(output.includes(secretValue), false);
});
