// Foundation 5C.1: private local files only. Deliberately no database or network client.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseLegacyContent } = require('../compatibility/content');
const { fingerprintIdentity } = require('./fingerprints');
const { entities, dependencyOrder, planMigration } = require('./planner');
const { evaluatePostSlugs, planLegacyPostCompatibility } = require('./legacyExceptions');
const { classifyMissingSettings } = require('./legacyPreservation');
const { compareSchemas } = require('./schemaMapping');
const sourceSchema = require('../../database/schema-evidence/foundation-4/aiven-source-schema.json');
const targetSchema = require('../../database/schema-evidence/foundation-4/kroombox-target-schema.json');
const roster = sourceSchema.tables.map(t => t.name).sort();
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const stable = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const digest = value => sha(stable(value));
const fail = code => { throw Error(code); }; // Never interpolate source values into errors.
const pk = table => table === 'update_history' ? 'update_id' : 'id';
const tableSchema = table => sourceSchema.tables.find(t => t.name === table);
const clone = value => JSON.parse(JSON.stringify(value));
const quote = name => { if (!/^[a-z_][a-z0-9_]*$/.test(name)) fail('unsafe_identifier'); return '`' + name + '`'; };
// Hex literals avoid SQL-mode-sensitive backslash/quote escaping. Strings remain UTF-8 bytes.
function sqlValue(value) {
    if (value === null) return 'NULL';
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    if (typeof value === 'string') return `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;
    if (value && Object.keys(value).length === 1 && typeof value.base64 === 'string' && Buffer.from(value.base64, 'base64').toString('base64') === value.base64) return `X'${Buffer.from(value.base64, 'base64').toString('hex')}'`;
    fail('unsupported_sql_value');
}
function privateDirectory(directory, create = false) {
    if (!directory || !path.isAbsolute(directory)) fail('absolute_private_directory_required');
    let current = path.parse(directory).root;
    for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        if (!fs.existsSync(current)) { if (create && current === directory) fs.mkdirSync(current, { mode: 0o700 }); else fail('directory_missing'); }
        if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) fail('unsafe_directory');
        const git = path.join(current, '.git');
        // Managed sandboxes reserve empty .git directories outside actual checkouts.
        if (fs.existsSync(git) && (!fs.statSync(git).isDirectory() || fs.existsSync(path.join(git, 'HEAD')))) fail('private_data_must_be_outside_git');
    }
    const stat = fs.statSync(directory);
    if (stat.mode & 0o077 || stat.uid !== process.getuid()) fail('private_directory_permissions_required');
    return directory;
}
function readPrivate(directory, name) {
    if (path.basename(name) !== name) fail('unsafe_file_name');
    const file = path.join(directory, name);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const s = fs.fstatSync(fd);
        if (!s.isFile() || s.nlink !== 1 || s.mode & 0o077 || s.uid !== process.getuid() || s.size > 64 * 1024 * 1024) fail('unsafe_private_file');
        const bytes = fs.readFileSync(fd);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const parsed = parseLegacyContent(text);
        if (parsed.readOnly || !parsed.value || typeof parsed.value !== 'object') fail('invalid_json_document');
        return { value: parsed.value, checksum: sha(bytes) };
    } finally { fs.closeSync(fd); }
}
function validateValue(column, value) {
    if (value === null) { if (!column.nullable) fail('null_not_allowed'); return; }
    const type = column.type;
    if (/^(tinyint|int|bigint)/.test(type)) {
        if (!Number.isSafeInteger(value) || (/unsigned/.test(type) && value < 0) || (/^int\b/.test(type) && (value < -2147483648 || value > 2147483647)) || (/^tinyint/.test(type) && (value < -128 || value > 127))) fail('invalid_integer');
    } else if (/^(varchar|char|text|longtext|enum|date|timestamp)/.test(type)) {
        if (typeof value !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail('invalid_string');
        const length = /^(?:var)?char\((\d+)\)/.exec(type);
        if (length && [...value].length > Number(length[1])) fail('string_too_long');
        if (type.startsWith('enum(') && !type.slice(5, -1).split(',').map(v => v.slice(1, -1)).includes(value)) fail('invalid_enum');
        if (/^(date|datetime|timestamp)/.test(type)) {
            const dateOnly = type === 'date';
            if (!(dateOnly ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).test(value)) fail('invalid_timestamp');
            const d = new Date(value.replace(' ', 'T') + (dateOnly ? 'T00:00:00Z' : 'Z'));
            if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, dateOnly ? 10 : 19).replace('T', ' ') !== value) fail('invalid_timestamp');
        }
        if ((type === 'text' && Buffer.byteLength(value) > 65535)) fail('text_too_long');
    } else fail('unsupported_column_type');
}
function validateRows(table, rows) {
    if (!Array.isArray(rows)) fail('invalid_table_rows');
    const schema = tableSchema(table), seen = new Set();
    for (const row of rows) {
        if (!row || Array.isArray(row) || typeof row !== 'object' || Object.keys(row).length !== schema.columns.length) fail('row_schema_mismatch');
        for (const column of schema.columns) {
            if (!Object.hasOwn(row, column.name)) fail('missing_column');
            validateValue(column, row[column.name]);
        }
        const id = row[pk(table)];
        if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) fail('duplicate_or_invalid_primary_key');
        seen.add(id);
    }
    for (const index of schema.indexes.filter(i => i.unique && !i.primary)) {
        const keys = new Set();
        for (const row of rows) {
            const parts = index.columns.map(column => row[column]);
            if (parts.includes(null)) continue; // MySQL unique indexes allow multiple NULLs.
            const value = stable(parts);
            if (keys.has(value)) fail('duplicate_unique_key');
            keys.add(value);
        }
    }
    return [...rows].sort((a, b) => a[pk(table)] - b[pk(table)]);
}
function loadSnapshot(inputDirectory) {
    privateDirectory(inputDirectory);
    const manifest = readPrivate(inputDirectory, 'snapshot.json').value;
    if (manifest.version !== 1 || manifest.consistentSnapshot !== true || manifest.timeZone !== '+00:00' || !Array.isArray(manifest.tables) || manifest.tables.length !== 19 || new Set(manifest.tables.map(t => t.name)).size !== 19) fail('incomplete_snapshot_manifest');
    const rows = {}, checksums = {};
    for (const table of roster) {
        const entry = manifest.tables.find(t => t.name === table);
        if (!entry || !Number.isSafeInteger(entry.count) || entry.count < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail('incomplete_snapshot_manifest');
        const file = readPrivate(inputDirectory, `${table}.json`);
        if (file.checksum !== entry.sha256) fail('snapshot_checksum_mismatch');
        rows[table] = validateRows(table, file.value);
        if (rows[table].length !== entry.count) fail('snapshot_count_mismatch');
        checksums[table] = file.checksum;
    }
    return { rows, checksums, fingerprint: digest({ checksums, manifest }), manifest };
}
// Business dependencies include references that the legacy DB never constrained.
function references(table) {
    const refs = new Map(tableSchema(table).foreignKeys.map(f => [f.columns[0], f.referencedTable]));
    if (tableSchema(table).columns.some(c => c.name === 'tenant_id')) refs.set('tenant_id', 'tenants');
    if (tableSchema(table).columns.some(c => c.name === 'user_id')) refs.set('user_id', 'users');
    return refs;
}
function rowOrder(table, rows) {
    if (table !== 'media_folders') return rows;
    const result = [], pending = new Map(rows.map(r => [r.id, r]));
    while (pending.size) {
        const next = [...pending.values()].filter(r => r.parent_id === null || result.some(p => p.id === r.parent_id)).sort((a, b) => a.id - b.id);
        if (!next.length) fail('folder_cycle_or_missing_parent');
        for (const r of next) { result.push(r); pending.delete(r.id); }
    }
    return result;
}
function dependencyTables() {
    const result = [], visiting = new Set();
    function visit(table) {
        if (result.includes(table)) return;
        if (visiting.has(table)) fail('table_dependency_cycle');
        visiting.add(table);
        for (const dep of new Set([...(entities[table] || []), ...references(table).values()])) if (dep !== table && roster.includes(dep)) visit(dep);
        visiting.delete(table); result.push(table);
    }
    dependencyOrder(roster).forEach(visit);
    return result;
}
function protectedInventory(rows, key) {
    return Object.fromEntries(Object.entries(rows).map(([table, records]) => [table, records.map(row => {
        const clean = Object.fromEntries(Object.entries(row).filter(([k]) => ['id', 'tenant_id', 'user_id', 'author_id', 'uploaded_by', 'category_id', 'featured_image_id', 'folder_id', 'parent_id', 'post_id', 'status', 'role', 'template_type', 'slug', 'subdomain'].includes(k)));
        clean.id = row[pk(table)];
        if (row.email) clean.emailFingerprint = fingerprintIdentity(row.email, 'email', key);
        if (row.api_key) clean.fingerprint = fingerprintIdentity(row.api_key, 'api_key', key);
        return clean;
    })]));
}
function assetInventory(rows, key) {
    const assets = [];
    const hmac = text => crypto.createHmac('sha256', key).update(text).digest('hex');
    function scan(value, table, rowId, field, depth = 0) {
        if (depth > 100) fail('nested_content_too_deep');
        if (typeof value === 'string') {
            if (/^(https?:\/\/|\/)/i.test(value)) {
                let provider = 'relative';
                if (/^https?:\/\//i.test(value)) {
                    let host; try { host = new URL(value).hostname; } catch { fail('malformed_asset_url'); }
                    provider = host === 'drive.google.com' ? 'google_drive' : host.endsWith('.cloudinary.com') ? 'cloudinary' : host.endsWith('.kroombox.com') ? 'kroombox_cdn' : 'external';
                }
                assets.push({ table, rowId, fieldFingerprint: hmac(field), referenceFingerprint: hmac(value), provider, kind: /href|cta|link|nav/i.test(field) ? 'navigation_or_cta' : 'url_reference', availability: 'not_tested' });
            } else if (/^[\s]*[\[{]/.test(value)) {
                const parsed = parseLegacyContent(value);
                if (!parsed.readOnly) scan(parsed.value, table, rowId, field, depth + 1);
            }
        } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) scan(v, table, rowId, `${field}.${k}`, depth + 1);
    }
    for (const table of roster) for (const row of rows[table]) for (const [field, value] of Object.entries(row)) {
        if (/api_key|password|email|recipient|actor|message|description/i.test(field)) continue;
        if (['featured_image_id', 'folder_id', 'parent_id'].includes(field) && value !== null) assets.push({ table, rowId: row[pk(table)], kind: 'database_id', field, sourceId: value });
        else scan(value, table, row[pk(table)], field);
    }
    return assets;
}
function prepare(snapshot, options = {}) {
    const { key, target = {}, mappings: overrides = [], decisions = [], observations = [], scenario = 'A' } = options;
    if (!Buffer.isBuffer(key) || key.length !== 32 || !['A', 'B'].includes(scenario)) fail('invalid_planning_options');
    if (Object.keys(target).some(t => !['users', 'user_global_roles', ...roster].includes(t))) fail('unknown_target_inventory');
    for (const [table, rows] of Object.entries(target)) {
        if (!Array.isArray(rows) || rows.some(r => !Number.isSafeInteger(r[table === 'user_global_roles' ? 'user_id' : pk(table)]) || r[table === 'user_global_roles' ? 'user_id' : pk(table)] <= 0)) fail('invalid_target_reservations');
    }
    if (scenario === 'A' && Object.values(target).some(rows => rows.length)) fail('scenario_a_requires_empty_target');
    if (scenario === 'B' && (!(target.users || []).length || !(target.user_global_roles || []).some(r => r.role === 'super_admin'))) fail('scenario_b_requires_protected_target');
    // Never compare raw target emails with source HMACs or accept credential-bearing inventories.
    const targetAllowed = new Set(['id', 'update_id', 'user_id', 'tenant_id', 'role', 'subdomain', 'email', 'emailFingerprint', 'fingerprint']);
    for (const [table, rows] of Object.entries(target)) {
        const seen = new Set();
        for (const row of rows) {
            if (Object.keys(row).some(k => !targetAllowed.has(k))) fail('target_inventory_must_be_sanitized');
            const id = row[table === 'user_global_roles' ? 'user_id' : pk(table)];
            if (seen.has(id)) fail('duplicate_target_reservation');
            seen.add(id);
        }
    }
    const normalizedTarget = clone(target);
    for (const user of normalizedTarget.users || []) if (user.email) { user.emailFingerprint = fingerprintIdentity(user.email, 'email', key); delete user.email; }
    const source = protectedInventory(snapshot.rows, key), targetFingerprint = digest(normalizedTarget);
    const context = { sourceSnapshotFingerprint: snapshot.fingerprint, targetSnapshotFingerprint: targetFingerprint, schemaCollation: targetSchema.tables.find(t => t.name === 'posts').collation };
    const maps = {}, mappings = [], blockers = [];
    const block = code => blockers.push(code);
    for (const table of roster) {
        maps[table] = new Map();
        const occupied = new Set((target[table] || []).map(r => r[pk(table)]));
        let next = snapshot.rows[table].reduce((max, row) => Math.max(max, row[pk(table)]), [...occupied].reduce((max, id) => Math.max(max, id), 0));
        for (const row of snapshot.rows[table]) {
            const sid = row[pk(table)];
            const override = overrides.find(m => m.entity === table && String(m.sourceId) === String(sid));
            let tid = occupied.has(sid) ? ++next : sid;
            if (override) {
                if (table !== 'users' || override.mode !== 'verified_existing' || !Number.isSafeInteger(Number(override.targetId))) fail('unsupported_mapping_override');
                tid = Number(override.targetId);
            }
            if (tid > 2147483647) fail('target_id_overflow');
            maps[table].set(sid, tid); occupied.add(tid);
            mappings.push({ entity: table, sourceId: String(sid), targetId: String(tid), mode: 'insert', ...override,
                ...(row.tenant_id != null ? { sourceTenantId: String(row.tenant_id) } : {}),
                ...(table === 'tenant_users' ? { sourceUserId: String(row.user_id) } : {}) });
        }
    }
    if (overrides.some(o => !mappings.some(m => m.entity === o.entity && m.sourceId === String(o.sourceId)))) fail('unmatched_mapping_override');
    for (const m of mappings) {
        if (m.sourceTenantId) m.targetTenantId = String(maps.tenants.get(Number(m.sourceTenantId)));
        if (m.sourceUserId) m.targetUserId = String(maps.users.get(Number(m.sourceUserId)));
    }
    // Use the established decision verifier; numeric collisions resolved by allocation are not merges.
    const identityPlan = planMigration({ batchId: `reh-${snapshot.fingerprint.slice(0, 32)}`, sourceSystem: 'aiven_v2', targetEnvironment: 'kroombox_staging', source, target: normalizedTarget, mappings, identityEquivalences: decisions, decisionContext: context, validationResults: [{ status: 'passed' }] });
    for (const c of identityPlan.conflicts) {
        if (c.type === 'numeric_id_collision' && mappings.some(m => m.entity === c.entity && m.sourceId === c.sourceId && m.targetId !== c.sourceId && m.mode === 'insert')) continue;
        block(c.type);
    }
    const transformed = {};
    for (const table of roster) {
        transformed[table] = rowOrder(table, snapshot.rows[table]).map(row => {
            const result = { ...row, [pk(table)]: maps[table].get(row[pk(table)]) };
            for (const [field, parent] of references(table)) if (row[field] !== null) {
                const related = snapshot.rows[parent].find(p => p[pk(parent)] === row[field]);
                if (!related) { block('missing_reference'); continue; }
                if (row.tenant_id !== null && related.tenant_id != null && row.tenant_id !== related.tenant_id) block('cross_tenant_reference');
                result[field] = maps[parent].get(row[field]);
                if (parent === 'users' && row.tenant_id != null && !snapshot.rows.tenant_users.some(m => m.user_id === row[field] && m.tenant_id === row.tenant_id)) block('user_not_in_tenant');
            }
            if (table === 'api_keys') result.api_key = 'reh_' + crypto.createHmac('sha256', key).update(`${snapshot.fingerprint}:api:${row.id}`).digest('hex');
            return result;
        });
    }
    for (const table of ['pages']) {
        const slugs = new Set();
        for (const row of source[table]) {
            const slug = `${row.tenant_id}:${row.slug.normalize('NFKC').trim().toLowerCase()}`;
            if (slugs.has(slug)) block('duplicate_page_slug');
            slugs.add(slug);
        }
    }
    const slugFindings = evaluatePostSlugs(source.posts, decisions, context);
    for (const f of slugFindings) {
        if (!f.approved) block('unresolved_post_slug');
        if (f.apiDetailReviewRequired && planLegacyPostCompatibility(f, observations.find(o => stable(o.sourceIds) === stable(f.sourceIds)), decisions.find(d => d.findingType === 'legacy_api_ambiguity' && stable(d.sourceIds) === stable(f.sourceIds)), context).status !== 'reviewed_for_rehearsal') block('legacy_detail_ambiguity');
    }
    const missingSettings = source.tenants.filter(t => !source.settings.some(s => s.tenant_id === t.id)).map(t => classifyMissingSettings(source, t.id, decisions.find(d => d.findingType === 'missing_optional_settings' && String(d.workspaceId) === String(t.id)), context));
    // JS cannot prove equivalence to MySQL Unicode collations. These require local reviewed evidence.
    const schema = compareSchemas(sourceSchema, targetSchema);
    const report = { version: 1, scenario, sourceFingerprint: snapshot.fingerprint, targetFingerprint, keyFingerprint: sha(key), counts: Object.fromEntries(roster.map(t => [t, source[t].length])), order: dependencyTables(), mappings, blockers: [...new Set(blockers)].sort(), slugFindings, missingSettings, schema, apiKeyPolicy: 'surrogate_only', assetInventory: assetInventory(snapshot.rows, key), requiredReviews: ['consistent_export', 'target_isolation', 'target_reservations', 'schema_mapping', 'target_collation_unique_keys', 'content_json_roundtrip', 'media_references', 'api_v1_compatibility', 'backup_restore', 'password_hash_compatibility', 'all_discrepancies'] };
    report.provenance = report.mappings.map(m => ({ entity: m.entity, sourceId: m.sourceId, targetId: m.targetId, recordHmac: crypto.createHmac('sha256', key).update(stable(snapshot.rows[m.entity].find(row => String(row[pk(m.entity)]) === m.sourceId))).digest('hex') }));
    report.apiKeyIntegrity = source.api_keys.map(k => ({ sourceId: String(k.id), targetId: String(maps.api_keys.get(k.id)), originalHmac: k.fingerprint, surrogateHmac: fingerprintIdentity(transformed.api_keys.find(r => r.id === maps.api_keys.get(k.id)).api_key, 'api_key', key) }));
    report.planFingerprint = digest(report);
    return { report, transformed, source, target: normalizedTarget, snapshot, context };
}
module.exports = { roster, sourceSchema, targetSchema, pk, sha, digest, stable, quote, sqlValue, privateDirectory, readPrivate, loadSnapshot, validateRows, dependencyTables, prepare };
