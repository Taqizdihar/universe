const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const express = require('express');
const bcrypt = require('bcrypt');
const { createPasswordRecoveryRouter, tokenHash } = require('../server/routes/passwordRecovery');
const { currentVersion, bumpVersion } = require('../security/authVersion');
const { sendPasswordResetEmail } = require('../services/emailService');
process.env.FRONTEND_URL = 'https://cms.example.test';
process.env.EMAIL_FROM = 'verified@example.test';

async function fixture(options = {}) {
    const user = { id: 7, email: 'user@example.test', password_hash: await bcrypt.hash('OldPassword123!', 4) };
    const tokens = [], mails = [], versions = new Map();
    let nextId = 1, queue = Promise.resolve();
    const valid = t => t && !t.used && t.expires > Date.now();
    const db = {
        async execute(sql, args = []) {
            const q = sql.toLowerCase();
            if (q.includes('limit 0')) { if (options.schema === false) { const e = Error('missing'); e.code = 'ER_NO_SUCH_TABLE'; throw e; } return [[]]; }
            if (q.startsWith('select version')) return [versions.has(args[0]) ? [{ version: versions.get(args[0]) }] : []];
            if (q.startsWith('select id from users where email')) return [args[0] === user.email ? [{ id: user.id }] : []];
            if (q.startsWith('select id from password_reset_tokens where token_hash')) return [tokens.filter(t => t.hash === args[0] && valid(t)).map(t => ({ id: t.id }))];
            if (q.startsWith('update password_reset_tokens')) { tokens.filter(t => t.userId === args[0] && t.id < args[1]).forEach(t => { t.used = true; }); return [{}]; }
            if (q.startsWith('delete from password_reset_tokens where id')) { const i = tokens.findIndex(t => t.id === args[0]); if (i >= 0) tokens.splice(i, 1); return [{}]; }
            throw Error(`Unexpected query: ${sql}`);
        },
        async getConnection() {
            let unlock;
            return {
                async beginTransaction() { const previous = queue; queue = new Promise(resolve => { unlock = resolve; }); await previous; },
                async execute(sql, args = []) {
                    const q = sql.toLowerCase();
                    if (q.startsWith('select id from users where id')) return [args[0] === user.id ? [{ id: user.id }] : []];
                    if (q.startsWith('select id from password_reset_tokens where user_id')) return [tokens.filter(t => t.userId === args[0] && t.created > Date.now() - 60000).map(t => ({ id: t.id }))];
                    if (q.startsWith('insert into password_reset_tokens')) { const t = { id: nextId++, userId: args[0], hash: args[1], created: Date.now(), expires: Date.now() + 1800000, used: false }; tokens.push(t); return [{ insertId: t.id }]; }
                    if (q.startsWith('select user_id from password_reset_tokens')) return [tokens.filter(t => t.hash === args[0] && valid(t)).map(t => ({ user_id: t.userId }))];
                    if (q.startsWith('select id from password_reset_tokens where token_hash')) return [tokens.filter(t => t.hash === args[0] && t.userId === args[1] && valid(t)).map(t => ({ id: t.id }))];
                    if (q.startsWith('update users set password_hash')) { user.password_hash = args[0]; return [{}]; }
                    if (q.startsWith('insert into account_auth_state')) { versions.set(args[0], (versions.get(args[0]) || 0) + 1); return [{}]; }
                    if (q.startsWith('delete from password_reset_tokens where user_id')) { for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i].userId === args[0]) tokens.splice(i, 1); return [{}]; }
                    throw Error(`Unexpected transaction query: ${sql}`);
                },
                async commit() { unlock?.(); unlock = null; }, async rollback() { unlock?.(); unlock = null; }, release() {}
            };
        }
    };
    const app = express(); app.use(express.json());
    app.use('/api/auth', createPasswordRecoveryRouter({ db, bcrypt, bumpVersion, superAdminEmail: 'owner@example.test', sendPasswordResetEmail: async (email, url) => { mails.push({ email, url }); return options.mailWorks !== false; } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const post = async (route, body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
    const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('timed out'); };
    return { user, tokens, mails, versions, db, post, wait, close: () => new Promise(resolve => server.close(resolve)) };
}
const tokenOf = mail => new URLSearchParams(new URL(mail.url).hash.slice(1)).get('token');

test('generic email response, normalization, hashed token, trusted frontend, cooldown', async () => {
    const f = await fixture();
    try {
        const unknown = await f.post('/forgot-password', { email: 'unknown@example.test' });
        const known = await f.post('/forgot-password', { email: '  USER@Example.Test  ' });
        assert.deepEqual(known, unknown);
        await f.wait(() => f.mails.length === 1);
        const raw = tokenOf(f.mails[0]);
        assert.equal(f.mails[0].url.startsWith('https://cms.example.test/reset-password#token='), true);
        assert.equal(f.tokens[0].hash, tokenHash(raw));
        assert.equal(JSON.stringify(f.tokens).includes(raw), false);
        assert.equal((await f.post('/forgot-password', { email: 'bad' })).status, 400);
        await f.post('/forgot-password', { email: f.user.email });
        await f.post('/forgot-password', { email: 'owner@example.test' });
        assert.equal(f.mails.length, 1);
    } finally { await f.close(); }
});

test('expired and malformed tokens fail; valid reset hashes password, consumes token and revokes sessions', async () => {
    const f = await fixture();
    try {
        await f.post('/forgot-password', { email: f.user.email }); await f.wait(() => f.mails.length === 1);
        const token = tokenOf(f.mails[0]);
        assert.equal((await f.post('/reset-password/validate', { token })).body.valid, true);
        assert.equal((await f.post('/reset-password/validate', { token: 'bad' })).body.valid, false);
        f.tokens[0].expires = Date.now() - 1;
        assert.equal((await f.post('/reset-password/validate', { token })).body.valid, false);
        f.tokens[0].expires = Date.now() + 1800000;
        const previousVersion = await currentVersion(f.db, f.user.id);
        assert.equal((await f.post('/reset-password', { token, newPassword: 'short', confirmPassword: 'short' })).status, 400);
        assert.equal((await f.post('/reset-password', { token, newPassword: 'NewPassword123!', confirmPassword: 'wrong' })).status, 400);
        assert.equal((await f.post('/reset-password', { token, newPassword: 'NewPassword123!', confirmPassword: 'NewPassword123!' })).status, 200);
        assert.equal(await bcrypt.compare('NewPassword123!', f.user.password_hash), true);
        assert.equal(await bcrypt.compare('OldPassword123!', f.user.password_hash), false);
        assert.equal(await currentVersion(f.db, f.user.id), previousVersion + 1);
        assert.equal((await f.post('/reset-password/validate', { token })).body.valid, false);
        assert.equal((await f.post('/reset-password', { token, newPassword: 'AnotherPassword123!', confirmPassword: 'AnotherPassword123!' })).status, 400);
    } finally { await f.close(); }
});

test('concurrent use succeeds once', async () => {
    const f = await fixture();
    try {
        await f.post('/forgot-password', { email: f.user.email }); await f.wait(() => f.mails.length === 1);
        const body = { token: tokenOf(f.mails[0]), newPassword: 'NewPassword123!', confirmPassword: 'NewPassword123!' };
        assert.deepEqual((await Promise.all([f.post('/reset-password', body), f.post('/reset-password', body)])).map(r => r.status).sort(), [200, 400]);
        assert.equal(f.versions.get(f.user.id), 1);
    } finally { await f.close(); }
});

test('a delivered replacement revokes older links; failed delivery preserves them', async () => {
    const options = {};
    const f = await fixture(options);
    try {
        await f.post('/forgot-password', { email: f.user.email }); await f.wait(() => f.mails.length === 1);
        const first = tokenOf(f.mails[0]);
        f.tokens[0].created = Date.now() - 61000;
        options.mailWorks = false;
        await f.post('/forgot-password', { email: f.user.email }); await f.wait(() => f.mails.length === 2);
        await f.wait(() => f.tokens.length === 1);
        assert.equal((await f.post('/reset-password/validate', { token: first })).body.valid, true);
        options.mailWorks = true;
        await f.post('/forgot-password', { email: f.user.email }); await f.wait(() => f.mails.length === 3);
        await f.wait(() => f.tokens[0]?.used === true);
        assert.equal((await f.post('/reset-password/validate', { token: first })).body.valid, false);
        assert.equal((await f.post('/reset-password/validate', { token: tokenOf(f.mails[2]) })).body.valid, true);
    } finally { await f.close(); }
});

test('missing migration gates recovery; SMTP failure removes token; IP limit applies', async () => {
    const noSchema = await fixture({ schema: false });
    try { assert.equal((await noSchema.post('/forgot-password', { email: noSchema.user.email })).status, 503); } finally { await noSchema.close(); }
    const noMail = await fixture({ mailWorks: false });
    try { await noMail.post('/forgot-password', { email: noMail.user.email }); await noMail.wait(() => noMail.mails.length === 1); await noMail.wait(() => noMail.tokens.length === 0); } finally { await noMail.close(); }
    const limited = await fixture();
    try { for (let i = 0; i < 8; i++) assert.equal((await limited.post('/forgot-password', { email: `unknown${i}@example.test` })).status, 200); assert.equal((await limited.post('/forgot-password', { email: 'last@example.test' })).status, 429); } finally { await limited.close(); }
});

test('legacy JWT auth version remains valid before the manual migration', () => {
    const script = `const { currentVersion, bumpVersionIfAvailable } = require('./security/authVersion');
      const missing = { execute: async () => { const e = Error('missing'); e.code = 'ER_NO_SUCH_TABLE'; throw e; } };
      (async () => { if (await currentVersion(missing, 7) !== 0) process.exit(1);
        if (await bumpVersionIfAvailable(missing, 7) !== false) process.exit(2); })().catch(() => process.exit(3));`;
    const result = spawnSync(process.execPath, ['-e', script], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

test('partial migration cannot silently bypass session revocation', () => {
    const script = `const { currentVersion } = require('./security/authVersion');
      const db = { execute: async sql => { if (sql.includes('account_auth_state')) { const e = Error('missing'); e.code = 'ER_NO_SUCH_TABLE'; throw e; } return [[]]; } };
      currentVersion(db, 7).then(() => process.exit(1), () => process.exit(0));`;
    const result = spawnSync(process.execPath, ['-e', script], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

test('transactional email uses mock SMTP with HTML and plain text', async () => {
    let message;
    const url = `https://cms.example.test/reset-password#token=${'a'.repeat(64)}`;
    const sent = await sendPasswordResetEmail('synthetic@example.test', url, { async sendMail(options) { message = options; } });
    assert.equal(sent, true);
    assert.equal(message.to, 'synthetic@example.test');
    assert.match(message.subject, /Pemulihan Kata Sandi/);
    assert.ok(message.html.includes(url));
    assert.ok(message.text.includes(url));
    assert.match(message.text, /30 menit/);
});
