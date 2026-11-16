// SQL text generator only. No connection, execution, or application-startup integration.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { roster, targetSchema, pk, digest, sha, quote: q, sqlValue: v, privateDirectory } = require('./snapshotPackage');
const database = '`uniin_universe_reh`';
const header = `-- MANUAL REVIEW ONLY. Never import into development or production.\nUSE ${database};\nSET NAMES utf8mb4;\nSET time_zone = '+00:00';\nSET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';\n`;
const ref = table => `${database}.${q(table)}`;
const checklist = `# Private manual rehearsal checklist\n\nNo backend or public site may point to rehearsal. Confirm isolation and the Foundation 5B 28-table checks first.\n\nCheck published Pages, published Posts, detail endpoints, navigation order, Settings/Footer, category filtering, media URLs, drafts excluded, and tenant API-key authorization. Specifically record Sentra Kreasi tenant 5 Article/Event duplicate-slug list membership and the detail endpoint's observed selection. Do not rename or unpublish either record. Scenario A is data fidelity only; Scenario B also requires protected identity, credential and global-role comparisons. Neither proves production cutover readiness.\n\nUse surrogate keys only. Real-key tests require separate security approval; this generator does not support them. URL availability, CDN identifiers, embedded database IDs, nested content, CTA and navigation semantics need human review; no assets are fetched or rewritten.\n`;
function approved(plan, review) {
    const r = plan.report;
    if (!review || review.version !== 1 || review.planFingerprint !== r.planFingerprint || review.administratorReviewStatus !== 'approved' || !Number.isFinite(Date.parse(review.reviewedAt)) || !review.approvalReference || review.database !== 'uniin_universe_reh' || review.scenario !== r.scenario || r.blockers.length) return false;
    // No boolean bypass for previous decision checks: they have already run in prepare().
    if (!r.requiredReviews.every(name => review.checks?.[name]?.status === 'passed' && /^[a-f0-9]{64}$/.test(review.checks[name].evidenceSha256 || '') && typeof review.checks[name].evidenceFile === 'string')) return false;
    try {
        for (const name of r.requiredReviews) {
            const item = review.checks[name];
            const stat = fs.lstatSync(item.evidenceFile);
            if (!path.isAbsolute(item.evidenceFile) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077 || stat.uid !== process.getuid() || stat.size > 64 * 1024 * 1024 || sha(fs.readFileSync(item.evidenceFile)) !== item.evidenceSha256) return false;
            privateDirectory(path.dirname(item.evidenceFile));
            const doc = JSON.parse(fs.readFileSync(item.evidenceFile, 'utf8'));
            if (doc.planFingerprint !== r.planFingerprint || doc.check !== name || doc.administratorReviewStatus !== 'approved' || !Number.isFinite(Date.parse(doc.reviewedAt))) return false;
        }
    } catch { return false; }
    return true;
}
const insert = (table, row, guard = '') => `INSERT INTO ${ref(table)} (${Object.keys(row).map(q).join(',')}) SELECT ${Object.values(row).map(v).join(',')}${guard ? ` WHERE ${guard}` : ''};`;
function equality(table, row) {
    return `EXISTS (SELECT 1 FROM ${ref(table)} WHERE ${Object.entries(row).map(([c, value]) => `BINARY ${q(c)} <=> BINARY ${v(value)}`).join(' AND ')})`;
}
function sqlFiles(plan, review, batchSize = 100) {
    if (!approved(plan, review)) throw Error('sql_generation_requires_bound_local_review');
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw Error('invalid_batch_size');
    const { report: r } = plan, files = {};
    const batchId = 'reh-' + digest({ plan: r.planFingerprint, review, batchSize }).slice(0, 40);
    const omitted = new Set(r.mappings.filter(m => m.mode === 'verified_existing').map(m => `${m.entity}:${m.targetId}`));
    let predecessor = null, index = 0;
    const stageIds = [];
    const checks = [];
    for (const table of r.order) {
        const rows = plan.transformed[table].filter(row => !omitted.has(`${table}:${row[pk(table)]}`));
        for (let offset = 0; offset < rows.length; offset += batchSize) {
            const part = rows.slice(offset, offset + batchSize), stageId = `${batchId}-${String(++index).padStart(5, '0')}`;
            const gate = ["DATABASE() = 'uniin_universe_reh'", `NOT EXISTS (SELECT 1 FROM ${ref('migration_batches')} WHERE batch_id = ${v(stageId)})`,
                ...(predecessor ? [`EXISTS (SELECT 1 FROM ${ref('migration_batches')} WHERE batch_id = ${v(predecessor)} AND status = 'prepared')`] : []),
                ...part.map(row => `NOT EXISTS (SELECT 1 FROM ${ref(table)} WHERE ${q(pk(table))} = ${v(row[pk(table)])})`)];
            // Exact table counts protect against stale reservations and unrelated additions/deletions.
            for (const t of roster) {
                const earlier = r.order.indexOf(t) < r.order.indexOf(table) ? plan.transformed[t].filter(row => !omitted.has(`${t}:${row[pk(t)]}`)).length : t === table ? offset : 0;
                gate.push(`(SELECT COUNT(*) FROM ${ref(t)}) = ${(plan.target[t] || []).length + earlier}`);
            }
            const marker = { batch_id: stageId, source_system: 'aiven_v2', target_environment: 'kroombox_staging', source_snapshot_fingerprint: r.sourceFingerprint, migration_type: 'rehearsal', status: 'prepared' };
            files[`stage-${String(index).padStart(5, '0')}-${table}.sql`] = header + `-- Abort import on the FIRST SQL error; never enable continue-on-error.\n-- prepared means locally imported, NOT validated/applied.\nSTART TRANSACTION;\nSET @reh_ok = (${gate.join(' AND ')});\nSELECT IF(@reh_ok, 'READY', 'STOP: repeated, partial, stale or wrong target') AS stage_guard;\n` + part.map(row => insert(table, row, '@reh_ok')).join('\n') + '\n' + insert('migration_batches', marker, `@reh_ok AND ${part.map(row => equality(table, row)).join(' AND ')}`) + '\nCOMMIT;\n';
            stageIds.push(stageId); predecessor = stageId;
        }
        const expected = (plan.target[table] || []).length + rows.length;
        checks.push(`SELECT ${v(table)} AS entity, COUNT(*) AS actual_count, ${expected} AS expected_count, COUNT(*) = ${expected} AS count_ok FROM ${ref(table)};`);
        for (const row of rows) checks.push(`SELECT ${v(table)} AS entity, ${row[pk(table)]} AS mapped_id, ${equality(table, row)} AS exact_bytes_and_nulls_ok;`);
        for (const fk of targetSchema.tables.find(t => t.name === table).foreignKeys) checks.push(`SELECT COUNT(*) AS orphan_count FROM ${ref(table)} c LEFT JOIN ${ref(fk.referencedTable)} p ON c.${q(fk.columns[0])}=p.${q(fk.referencedColumns[0])} WHERE c.${q(fk.columns[0])} IS NOT NULL AND p.${q(fk.referencedColumns[0])} IS NULL;`);
    }
    for (const role of plan.target.user_global_roles || []) checks.push(`SELECT EXISTS (SELECT 1 FROM ${ref('user_global_roles')} WHERE user_id = ${v(role.user_id)} AND BINARY role = BINARY ${v(role.role)}) AS protected_global_role_preserved;`);
    for (const row of plan.target.users || []) if (row.emailFingerprint) checks.push(`-- Protected user ${row.id}: administrator must privately compare credentials/global role with the pre-import export; no UPDATE is generated.`);
    checks.push(`SELECT batch_id,status FROM ${ref('migration_batches')} WHERE batch_id IN (${stageIds.length ? stageIds.map(v).join(',') : "''"}) ORDER BY batch_id;`);
    let part = [], bytes = 0, partIndex = 0;
    const flush = () => { if (part.length) files[`postflight-${String(++partIndex).padStart(5, '0')}.sql`] = header + '-- Read-only: exact bytes imply preserved JSON semantics; discrepancies STOP the rehearsal.\n' + part.join('\n') + '\n'; part = []; bytes = 0; };
    for (const check of checks) { if (bytes + Buffer.byteLength(check) > 4 * 1024 * 1024) flush(); part.push(check); bytes += Buffer.byteLength(check); }
    flush();
    if (Object.values(files).some(text => Buffer.byteLength(text) > 8 * 1024 * 1024)) throw Error('sql_file_limit_exceeded_use_smaller_snapshot_or_batches');
    return { files, batchId, stageIds };
}
function writePackage(directory, plan, review, batchSize) {
    privateDirectory(directory, true);
    if (fs.readdirSync(directory).length) throw Error('output_must_be_empty');
    const r = plan.report;
    const generated = review ? sqlFiles(plan, review, batchSize) : null;
    const files = {
        'migration-identity-plan.json': JSON.stringify(r, null, 2) + '\n',
        'integrity-report.json': JSON.stringify({ planFingerprint: r.planFingerprint, status: generated ? 'approved_for_manual_review_only' : 'planning_only_no_dml', blockers: r.blockers, counts: r.counts, originalKeyIntegrity: 'HMAC in private inventory; SQL uses surrogates', executions: 0 }, null, 2) + '\n',
        'api-compatibility-checklist.md': checklist,
        'preflight.sql': header + '-- READ ONLY. Compare these results to approved reservations before importing any stage.\n' + targetSchema.tables.map(t => `SELECT ${v(t.name)} AS entity, COUNT(*) AS actual_count FROM ${ref(t.name)};`).join('\n') + '\n',
        ...(generated?.files || {})
    };
    const manifest = { version: 1, database: 'uniin_universe_reh', scenario: r.scenario, planFingerprint: r.planFingerprint, sourceFingerprint: r.sourceFingerprint, batchId: generated?.batchId || null, stageIds: generated?.stageIds || [], mode: generated ? 'manual_review_sql' : 'planning_only', checksums: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, sha(text)])) };
    files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), text, { mode: 0o600, flag: 'wx' });
    return manifest;
}
async function syntheticBootstrap(directory) {
    privateDirectory(directory, true);
    if (fs.readdirSync(directory).length) throw Error('output_must_be_empty');
    // Random discarded 256-bit password: no known usable credential and no real identity.
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    const user = { id: 1, name: 'Fictional Rehearsal Administrator', email: 'admin@rehearsal.invalid', password_hash: hash };
    const sql = header + '-- Separate Scenario B approval required. Empty target only; never execute automatically.\nSTART TRANSACTION;\nSET @reh_bootstrap_ok = ' + targetSchema.tables.map(t => `(SELECT COUNT(*) FROM ${ref(t.name)}) = 0`).join(' AND ') + ";\nSELECT IF(@reh_bootstrap_ok, 'READY', 'STOP: target not empty') AS bootstrap_guard;\n" + insert('users', user, '@reh_bootstrap_ok') + '\n' + insert('user_global_roles', { user_id: 1, role: 'super_admin' }, '@reh_bootstrap_ok') + '\nCOMMIT;\n';
    fs.writeFileSync(path.join(directory, 'bootstrap-synthetic-admin.sql'), sql, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(directory, 'target-reservations.json'), JSON.stringify({ users: [{ id: 1, email: user.email }], user_global_roles: [{ user_id: 1, role: 'super_admin' }] }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
module.exports = { approved, sqlFiles, writePackage, syntheticBootstrap };
