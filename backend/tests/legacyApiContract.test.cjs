const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const manifest = require('../compatibility/contracts/legacy-api-v1.json');
const fixture = require('../compatibility/fixtures/legacy-tenants.json').restaurant;
process.env.BASE_URL = 'https://api.example.test';
const page = fixture.page;
const posts = [{ id: 401, tenant_id: 101, slug: 'news', title: 'News', status: 'published', template_type: 'Artikel', excerpt: 'Short', content: JSON.stringify([{ body_content: '<p>News&nbsp;<strong>update</strong></p>' }]) }];
const db = { async execute(sql, params = []) {
    const q = sql.toLowerCase().replace(/\s+/g, ' ');
    if (q.includes('from api_keys ak join tenants t')) return [params[0] === 'key-a' ? [{ tenant_id: 101 }] : []];
    if (q.startsWith('select id from posts')) { assert.equal(params[1], 101); return [String(params[0]) === '401' ? [{ id: 401 }] : []]; }
    if (q.startsWith('insert into comments')) { assert.equal(params[1], 101); return [{ insertId: 55 }]; }
    if (q.includes('from comments')) { assert.equal(params[1], 101); return [[{ id: 1, author_name: 'Reader', content: 'Approved', created_at: '2026-01-01' }]]; }
    assert.equal(params[0], 101, 'tenant isolation');
    if (q.includes('from settings')) return [[{ title: fixture.settings.site_name, tagline: fixture.settings.tagline, logo_url: fixture.settings.logo_url, global_options: fixture.settings.global_options }]];
    if (q.includes('from post_categories')) return [[{ id: 1, tenant_id: 101, name: 'News', slug: 'news' }]];
    if (q.includes('from pages')) {
        assert.match(q, /status = 'published'/);
        if (q.includes('is_in_navbar')) return [[{ title: page.title, slug: page.slug }]];
        return [structuredClone([page].filter(p => !q.includes('slug = ?') || p.slug === params[1]))];
    }
    if (q.includes('from posts')) {
        assert.match(q, /posts\.status = 'published'/);
        assert.match(q, /post_categories\.tenant_id = posts\.tenant_id/);
        return [structuredClone(posts.filter(p => !q.includes('posts.slug = ?') || p.slug === params[1]))];
    }
    throw Error(`Unexpected SQL: ${sql}`);
} };
const dbPath = require.resolve('../server/lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
const router = require('../server/routes/data');

test('manifest matches the real public router', () => {
    const source = require('node:fs').readFileSync(require.resolve('../server/routes/data'), 'utf8');
    assert.equal(manifest.endpoints.length, 9);
    for (const item of manifest.endpoints) {
        assert.equal(item.authentication, 'x-api-key (active tenant)');
        assert.ok(source.includes(`router.${item.method.toLowerCase()}('${item.path.replace('/api/v1/public', '')}'`), item.id);
    }
});

test('actual router preserves public roots, filtering, aliases, footer, navigation and comments', async t => {
    const app = express(); app.use(express.json()); app.use('/api/v1/public', router);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const get = async (path, key = 'key-a') => { const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/public${path}`, { headers: key ? { 'x-api-key': key } : {} }); return { status: res.status, body: await res.json() }; };
    assert.equal((await get('/pages', '')).status, 401);
    assert.equal((await get('/pages', 'bad')).status, 401);
    const pages = await get('/pages'); assert.equal(pages.status, 200); assert.ok(Array.isArray(pages.body));
    assert.equal(pages.body[0].content[0].data.hero_image, 'https://api.example.test/uploads/hero.jpg');
    assert.equal(pages.body[0].is_contact_form_active, true);
    assert.equal((await get('/pages/home')).body.slug, 'home');
    assert.equal((await get('/pages/draft')).status, 404);
    const list = await get('/posts'); assert.ok(Array.isArray(list.body)); assert.equal(list.body[0].summary, 'Short');
    assert.equal(list.body[0].content[0].body_content, '<p>News <strong>update</strong></p>');
    assert.equal((await get('/posts/news')).body.slug, 'news');
    assert.equal((await get('/posts/draft')).status, 404);
    assert.deepEqual((await get('/navigation')).body, [{ title: 'Home', slug: 'home' }]);
    assert.equal((await get('/post-categories')).body[0].name, 'News');
    const settings = (await get('/settings')).body;
    assert.equal(settings.site_name, settings.title); assert.equal(settings.footer_text, 'Visit us');
    assert.equal(settings.address, settings.alamat); assert.deepEqual(settings.footer_nav_1, [{ label: 'Menu', url: '/menu' }]);
    assert.equal(settings.logo_url, 'https://api.example.test/uploads/logo.png');
    assert.equal((await get('/posts/401/comments')).body[0].content, 'Approved');
    const submit = async id => { const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/public/posts/${id}/comments`, { method: 'POST', headers: { 'x-api-key': 'key-a', 'content-type': 'application/json' }, body: JSON.stringify({ author_name: 'Test', author_email: 'test@example.test', content: 'Hello' }) }); return res; };
    assert.equal((await submit(401)).status, 201);
    assert.equal((await submit(402)).status, 404);
});
