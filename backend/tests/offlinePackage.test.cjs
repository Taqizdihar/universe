const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const Module = require('node:module');
const s = require('../migration/snapshotPackage');
const p = require('../migration/packageSql');
const { fingerprintIdentity } = require('../migration/fingerprints');
const key = Buffer.alloc(32, 42);
function temp(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'universe-private-')); fs.chmodSync(d, 0o700); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; }
function row(table, overrides = {}) {
    const r = {};
    for (const c of s.sourceSchema.tables.find(t => t.name === table).columns) {
        r[c.name] = c.nullable ? null : /^(int|tinyint)/.test(c.type) ? 1 : c.type.startsWith('enum') ? c.type.slice(6).split("'")[0] : 'synthetic';
    }
    return { ...r, ...overrides };
}
function fixture() {
    const rows = Object.fromEntries(s.roster.map(t => [t, []]));
    rows.users = [row('users', { email: 'source@example.invalid', password_hash: 'synthetic-not-a-real-hash' })];
    rows.tenants = [row('tenants', { subdomain: 'fictional' })];
    rows.tenant_users = [row('tenant_users', { role: 'admin', status: 'active' })];
    rows.pages = [row('pages', { tenant_id: 1, slug: 'home', content: '{ "title": "こんにちは 🌏", "href": "https://example.invalid/path?token=private" }' })];
    rows.posts = [row('posts', { tenant_id: 1, slug: 'article', status: 'published', template_type: 'article' })];
    rows.api_keys = [row('api_keys', { api_key: 'synthetic-sensitive-test-key' })];
    rows.media_folders = [row('media_folders', { parent_id: null })];
    rows.media = [row('media', { tenant_id: 1, folder_id: 1, file_url: 'https://drive.google.com/file/d/fictional' })];
    rows.update_history = [row('update_history', { update_id: 8 })];
    rows.update_images = [row('update_images', { update_id: 8, image_url: 'https://example.invalid/update.png' })];
    return rows;
}
function save(d, rows) {
    const manifest = { version: 1, consistentSnapshot: true, timeZone: '+00:00', tables: [] };
    for (const name of s.roster) {
        const bytes = JSON.stringify(rows[name]);
        fs.writeFileSync(path.join(d, name + '.json'), bytes, { mode: 0o600 });
        manifest.tables.push({ name, count: rows[name].length, sha256: s.sha(bytes) });
    }
    fs.writeFileSync(path.join(d, 'snapshot.json'), JSON.stringify(manifest), { mode: 0o600 });
    return s.loadSnapshot(d);
}
function review(t, plan) {
    const d = temp(t), checks = {};
    for (const name of plan.report.requiredReviews) {
        const file = path.join(d, name + '.json');
        const doc = JSON.stringify({ check: name, planFingerprint: plan.report.planFingerprint, administratorReviewStatus: 'approved', reviewedAt: '2026-11-16T00:00:00Z' });
        fs.writeFileSync(file, doc, { mode: 0o600 });
        checks[name] = { status: 'passed', evidenceFile: file, evidenceSha256: s.sha(doc) };
    }
    return { version: 1, database: 'uniin_universe_reh', scenario: plan.report.scenario, planFingerprint: plan.report.planFingerprint, administratorReviewStatus: 'approved', reviewedAt: '2026-11-16T00:00:00Z', approvalReference: 'fictional-review', checks };
}
test('complete private JSON snapshot: counts, checksums, malformed types, duplicate IDs, columns, timestamps', t => {
    const d = temp(t), rows = fixture();
    assert.equal(save(d, rows).manifest.tables.length, 19);
    const file = path.join(d, 'users.json'); fs.appendFileSync(file, ' ');
    assert.throws(() => s.loadSnapshot(d), /checksum/);
    rows.users[0].id = '1'; assert.throws(() => save(d, rows), /integer/);
    rows.users[0].id = 1; rows.users.push({ ...rows.users[0] }); assert.throws(() => save(d, rows), /duplicate/);
    rows.users.pop(); rows.users[0].unexpected = 'x'; assert.throws(() => save(d, rows), /schema/);
    delete rows.users[0].unexpected; rows.users[0].created_at = '2026-02-30 00:00:00'; assert.throws(() => save(d, rows), /timestamp/);
});
test('partial manifest, count mismatch and duplicate JSON keys are rejected', t => {
    const d = temp(t); save(d, fixture());
    const f = path.join(d, 'snapshot.json'), m = JSON.parse(fs.readFileSync(f));
    m.tables[0].count++; fs.writeFileSync(f, JSON.stringify(m)); assert.throws(() => s.loadSnapshot(d), /count/);
    m.tables.pop(); fs.writeFileSync(f, JSON.stringify(m)); assert.throws(() => s.loadSnapshot(d), /incomplete/);
    fs.writeFileSync(f, '{"version":1,"version":2}'); assert.throws(() => s.loadSnapshot(d), /invalid_json/);
});
test('private paths: reject public permissions, symlinks, hard links and Git checkouts', t => {
    const d = temp(t); save(d, fixture());
    fs.chmodSync(d, 0o755); assert.throws(() => s.loadSnapshot(d), /permissions/); fs.chmodSync(d, 0o700);
    const f = path.join(d, 'users.json'); fs.linkSync(f, path.join(d, 'linked')); assert.throws(() => s.loadSnapshot(d), /unsafe_private/); fs.unlinkSync(path.join(d, 'linked'));
    fs.renameSync(f, path.join(d, 'original')); fs.symlinkSync(path.join(d, 'original'), f); assert.throws(() => s.loadSnapshot(d));
    fs.mkdirSync(path.join(d, '.git')); fs.writeFileSync(path.join(d, '.git/HEAD'), 'ref: refs/heads/main'); assert.throws(() => s.privateDirectory(d), /outside_git/);
});
test('Scenario A preserves content bytes, missing Settings, update_id identity and all 19 mappings', t => {
    const snapshot = save(temp(t), fixture()), plan = s.prepare(snapshot, { key });
    assert.deepEqual(plan.report.blockers, []);
    assert.equal(plan.transformed.pages[0].content, snapshot.rows.pages[0].content);
    assert.deepEqual(plan.transformed.settings, []);
    assert.equal(plan.report.missingSettings[0].createSettings, false);
    assert.equal(plan.transformed.update_images[0].update_id, 8);
    assert.equal(plan.report.order.length, 19);
    assert.equal(plan.report.mappings.length, Object.values(snapshot.rows).flat().length);
    assert.deepEqual(s.prepare(snapshot, { key }).report, plan.report);
    const report = JSON.stringify(plan.report);
    for (const secret of ['source@example.invalid', 'synthetic-sensitive-test-key', 'synthetic-not-a-real-hash', 'token=private']) assert.equal(report.includes(secret), false);
    assert.ok(plan.report.assetInventory.some(a => a.provider === 'google_drive'));
    assert.ok(plan.report.assetInventory.some(a => a.kind === 'navigation_or_cta'));
    assert.notEqual(plan.transformed.api_keys[0].api_key, snapshot.rows.api_keys[0].api_key);
});
test('Scenario B allocates around protected ID and remaps memberships, never modifies target', t => {
    const target = { users: [{ id: 1, email: 'admin@rehearsal.invalid' }], user_global_roles: [{ user_id: 1, role: 'super_admin' }] }, original = JSON.stringify(target);
    const snapshot = save(temp(t), fixture());
    const plan = s.prepare(snapshot, { key, scenario: 'B', target });
    assert.deepEqual(plan.report.blockers, []);
    assert.equal(plan.transformed.users[0].id, 2);
    assert.equal(plan.transformed.tenant_users[0].user_id, 2);
    assert.equal(JSON.stringify(target), original);
    assert.throws(() => s.prepare(snapshot, { key, target }), /scenario_a/);
    assert.throws(() => s.prepare(snapshot, { key, scenario: 'B' }), /scenario_b/);
    assert.throws(() => s.prepare(snapshot, { key, scenario: 'B', target: { users: [{ id: 1, password_hash: 'secret' }], user_global_roles: target.user_global_roles } }), /sanitized/);
});
test('matching email never silently merges; verified-existing mapping needs existing evidence verifier', t => {
    const snapshot = save(temp(t), fixture());
    const target = { users: [{ id: 1, email: snapshot.rows.users[0].email }], user_global_roles: [{ user_id: 1, role: 'super_admin' }] };
    const options = { key, scenario: 'B', target };
    assert.ok(s.prepare(snapshot, options).report.blockers.includes('email_match_requires_review'));
    const result = s.prepare(snapshot, { ...options, mappings: [{ entity: 'users', sourceId: '1', targetId: '1', sourceTenantId: '1', mode: 'verified_existing', credentialPolicy: 'preserve_target', globalRolePolicy: 'no_import' }] });
    assert.ok(result.report.blockers.includes('unverified_existing_identity_mapping'));
});
test('FK and business dependency order, folder hierarchy and cycles, tenant isolation', t => {
    const rows = fixture(); rows.media_folders.push(row('media_folders', { id: 2, parent_id: 1 }));
    const plan = s.prepare(save(temp(t), rows), { key }), order = plan.report.order;
    for (const table of s.sourceSchema.tables) for (const fk of table.foreignKeys) if (fk.referencedTable !== table.name) assert.ok(order.indexOf(fk.referencedTable) < order.indexOf(table.name));
    assert.deepEqual(plan.transformed.media_folders.map(r => r.id), [1, 2]);
    rows.media_folders[0].parent_id = 2; assert.throws(() => s.prepare(save(temp(t), rows), { key }), /cycle/);
    rows.media_folders[0].parent_id = null;
    rows.tenants.push(row('tenants', { id: 2, subdomain: 'other' })); rows.posts[0].tenant_id = 1; rows.posts[0].category_id = 1;
    rows.post_categories.push(row('post_categories', { tenant_id: 2 }));
    assert.ok(s.prepare(save(temp(t), rows), { key }).report.blockers.includes('cross_tenant_reference'));
    rows.posts[0].category_id = 99; assert.ok(s.prepare(save(temp(t), rows), { key }).report.blockers.includes('missing_reference'));
});
test('slug and collation risks do not disappear under a blanket package approval', t => {
    const rows = fixture(); rows.posts.push({ ...rows.posts[0], id: 2 });
    const plan = s.prepare(save(temp(t), rows), { key });
    assert.equal(plan.report.slugFindings[0].type, 'same_template_published');
    assert.throws(() => p.sqlFiles(plan, review(t, plan)), /review/);
    rows.posts[1].template_type = 'event'; const cross = s.prepare(save(temp(t), rows), { key });
    assert.equal(cross.report.slugFindings[0].type, 'cross_template_published');
    assert.ok(cross.report.blockers.includes('legacy_detail_ambiguity'));
    assert.ok(cross.report.schema.findings.some(f => /collation/.test(f.code)));
});
test('SQL type encoding preserves Unicode, NULL, binary and injection strings independently of SQL mode', () => {
    const text = "'; DROP TABLE users; -- \\ 🌏\u0000";
    const encoded = s.sqlValue(text);
    assert.equal(encoded.includes('DROP'), false);
    assert.equal(Buffer.from(encoded.match(/X'([0-9a-f]+)'/)[1], 'hex').toString(), text);
    assert.equal(s.sqlValue(null), 'NULL');
    assert.equal(s.sqlValue({ base64: 'AP8=' }), "X'00ff'");
    assert.throws(() => s.sqlValue(1.5)); assert.throws(() => s.quote('users;DROP'));
});
test('review-bound generation, tamper rejection, bounded stages, replay and partial import guards', t => {
    const plan = s.prepare(save(temp(t), fixture()), { key });
    assert.throws(() => p.sqlFiles(plan), /review/);
    const r = review(t, plan), generated = p.sqlFiles(plan, r, 1);
    assert.deepEqual(p.sqlFiles(plan, r, 1), generated);
    const sql = Object.values(generated.files).join('\n');
    assert.match(sql, /USE `uniin_universe_reh`/);
    assert.match(sql, /NOT EXISTS.*migration_batches/);
    assert.match(sql, /STOP: repeated, partial, stale/);
    assert.match(sql, /exact_bytes_and_nulls_ok/);
    assert.doesNotMatch(sql, /INSERT IGNORE|FOREIGN_KEY_CHECKS|TRUNCATE|DELETE FROM|UPDATE `uniin_universe_reh`/);
    assert.equal(sql.includes('synthetic-sensitive-test-key'), false);
    const out = path.join(temp(t), 'output'); const manifest = p.writePackage(out, plan, r, 1);
    for (const [f, checksum] of Object.entries(manifest.checksums)) { assert.equal(s.sha(fs.readFileSync(path.join(out, f))), checksum); assert.equal(fs.statSync(path.join(out, f)).mode & 0o077, 0); }
    assert.throws(() => p.writePackage(out, plan), /empty/);
    r.planFingerprint = '0'.repeat(64); assert.throws(() => p.sqlFiles(plan, r), /review/); r.planFingerprint = plan.report.planFingerprint;
    fs.appendFileSync(r.checks.backup_restore.evidenceFile, ' '); assert.throws(() => p.sqlFiles(plan, r), /review/);
});
test('default package contains no data-bearing SQL; CLI errors redact private data', t => {
    const d = temp(t), snapshot = save(d, fixture()), plan = s.prepare(snapshot, { key });
    const out = path.join(temp(t), 'output'); assert.equal(p.writePackage(out, plan).mode, 'planning_only');
    assert.equal(fs.readdirSync(out).some(f => f.startsWith('stage-')), false);
    const invalid = spawnSync(process.execPath, [path.resolve(__dirname, '../migration/package.cjs'), '--input=secret-source-value'], { encoding: 'utf8' });
    assert.equal(invalid.status, 1); assert.equal(invalid.stderr.includes('secret-source-value'), false);
    fs.writeFileSync(path.join(d, 'key'), key, { mode: 0o600 });
    const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../migration/package.cjs'), `--input=${d}`, `--output=${path.join(temp(t), 'cli')}`, `--key=${path.join(d, 'key')}`], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout, 'Offline package saved privately. No SQL executed.\n');
});
test('synthetic bootstrap is separate, bcrypt compatible and exclusively rehearsal-scoped', async t => {
    const out = path.join(temp(t), 'bootstrap'); await p.syntheticBootstrap(out);
    const sql = fs.readFileSync(path.join(out, 'bootstrap-synthetic-admin.sql'), 'utf8');
    const hex = [...sql.matchAll(/CONVERT\(X'([a-f0-9]+)' USING utf8mb4\)/g)].map(m => Buffer.from(m[1], 'hex').toString());
    assert.ok(hex.includes('admin@rehearsal.invalid'));
    const hash = hex.find(v => v.startsWith('$2b$12$')); assert.ok(hash);
    assert.equal(await require('bcrypt').compare('password', hash), false);
    assert.match(sql, /uniin_universe_reh/); assert.doesNotMatch(sql, /TRUNCATE|DELETE|CREATE TABLE/);
});
test('planning/generation never imports DB, HTTP, app server or SQL executor', t => {
    const original = Module._load;
    Module._load = function(name, ...args) { if (/mysql|https?$|axios|server\.js|server\/lib\/db/.test(name)) throw Error('forbidden_runtime_dependency'); return original.call(this, name, ...args); };
    try { for (const name of ['../migration/snapshotPackage', '../migration/packageSql', '../migration/package.cjs']) delete require.cache[require.resolve(name)]; require('../migration/snapshotPackage'); require('../migration/packageSql'); const plan = s.prepare(save(temp(t), fixture()), { key }); assert.equal(p.writePackage(path.join(temp(t), 'package'), plan).mode, 'planning_only'); } finally { Module._load = original; }
});

test('evidence-backed existing Super Admin mapping skips user INSERT and preserves credentials/global role', t => {
    const snapshot = save(temp(t), fixture());
    const target = { users: [{ id: 1, emailFingerprint: fingerprintIdentity('source@example.invalid', 'email', key) }], user_global_roles: [{ user_id: 1, role: 'super_admin' }] };
    const ctx = s.prepare(snapshot, { key, scenario: 'B', target }).context;
    const evidenceFile = path.join(temp(t), 'identity.json');
    const decision = { decisionId: 'synthetic-identity', sourceEntity: 'users', sourceIds: ['1'], workspaceId: '1', targetId: '1', findingType: 'verified_existing_identity', action: 'map_to_existing_without_credential_change', sourceFingerprint: target.users[0].emailFingerprint, targetFingerprint: target.users[0].emailFingerprint, ...ctx, administratorReviewStatus: 'approved', reviewedAt: '2026-11-16T00:00:00Z', evidenceFile };
    const bytes = JSON.stringify({ decisions: [decision], checks: [{ checkId: decision.decisionId, conclusion: 'passed', observations: ['synthetic-only reviewed identity or slug evidence'] }] }); fs.writeFileSync(evidenceFile, bytes, { mode: 0o600 }); decision.evidenceSha256 = s.sha(bytes);
    const plan = s.prepare(snapshot, { key, scenario: 'B', target, decisions: [decision], mappings: [{ entity: 'users', sourceId: '1', targetId: '1', mode: 'verified_existing', sourceTenantId: '1', credentialPolicy: 'preserve_target', globalRolePolicy: 'no_import' }] });
    assert.deepEqual(plan.report.blockers, []);
    const sql = Object.values(p.sqlFiles(plan, review(t, plan)).files).join('\n');
    assert.doesNotMatch(sql, /INSERT INTO `uniin_universe_reh`\.`users`/);
    assert.doesNotMatch(sql, /INSERT INTO `uniin_universe_reh`\.`user_global_roles`/);
    assert.equal(plan.transformed.tenant_users[0].user_id, 1);
});

test('snapshot-bound cross-template preservation decision is honored; independent API review still blocks', t => {
    const rows = fixture(); rows.posts.push({ ...rows.posts[0], id: 2, template_type: 'event' });
    const snapshot = save(temp(t), rows), ctx = s.prepare(snapshot, { key }).context;
    const evidenceFile = path.join(temp(t), 'slugs.json');
    const decision = { decisionId: 'synthetic-slug', sourceEntity: 'posts', sourceIds: ['1', '2'], workspaceId: '1', findingType: 'cross_template_published', action: 'preserve_all_with_api_review', matchMode: 'exact', ...ctx, administratorReviewStatus: 'approved', reviewedAt: '2026-11-16T00:00:00Z', evidenceFile };
    const bytes = JSON.stringify({ decisions: [decision], checks: [{ checkId: decision.decisionId, conclusion: 'passed', observations: ['synthetic-only reviewed identity or slug evidence'] }] }); fs.writeFileSync(evidenceFile, bytes, { mode: 0o600 }); decision.evidenceSha256 = s.sha(bytes);
    const plan = s.prepare(snapshot, { key, decisions: [decision] });
    assert.equal(plan.report.slugFindings[0].approved, true);
    assert.equal(plan.report.blockers.includes('unresolved_post_slug'), false);
    assert.equal(plan.report.blockers.includes('legacy_detail_ambiguity'), true);
    assert.deepEqual(plan.transformed.posts.map(p => p.slug), ['article', 'article']);
    decision.sourceSnapshotFingerprint = 'unrelated';
    assert.equal(s.prepare(snapshot, { key, decisions: [decision] }).report.slugFindings[0].approved, false);
});

test('all 19 nonempty tables produce complete identity plans and dependency-ordered stages', t => {
    const rows = fixture();
    for (const table of s.roster) if (!rows[table].length) rows[table] = [row(table, s.sourceSchema.tables.find(t => t.name === table).columns.some(c => c.name === 'tenant_id') ? { tenant_id: 1 } : {})];
    const plan = s.prepare(save(temp(t), rows), { key });
    assert.deepEqual(plan.report.blockers, []);
    assert.equal(plan.report.mappings.length, 19);
    const result = p.sqlFiles(plan, review(t, plan));
    assert.equal(result.stageIds.length, 19);
    assert.equal(plan.report.provenance.length, 19);
    assert.equal(plan.report.apiKeyIntegrity.length, 1);
    assert.equal(plan.report.apiKeyIntegrity[0].originalHmac, fingerprintIdentity(rows.api_keys[0].api_key, 'api_key', key));
});
