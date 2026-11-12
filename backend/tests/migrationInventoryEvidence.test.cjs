const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { analyzeBundle, loadJson } = require('../migration/inventory');
const { compareSchemas } = require('../migration/schemaMapping');
const { buildOfflineReport } = require('../migration/offlineReport');
const { allChecks, validateEvidenceManifest, validateCountInventory, applyForeignKeyActions } = require('../migration/evidence');
const { fingerprintIdentity, compareFingerprintSets } = require('../migration/fingerprints');

const root = path.resolve(__dirname, '../../database/schema-evidence/foundation-4');
const evidenceFile = path.join(os.tmpdir(), `foundation4-evidence-${process.pid}.json`);
fs.writeFileSync(evidenceFile, JSON.stringify({ checks: [...allChecks, 'identity_mapping_decisions'].map(checkId => ({ checkId, conclusion: 'passed', observations: ['synthetic observation'] })), reviewedRedundantFks: ['tenant_users.tenant_users_ibfk_1', 'tenant_users.tenant_users_ibfk_2'] }));
process.on('exit', () => fs.rmSync(evidenceFile, { force: true }));
const evidenceSha256 = crypto.createHash('sha256').update(fs.readFileSync(evidenceFile)).digest('hex');
const input = () => ({ sourceSchema: loadJson(path.join(root, 'aiven-source-schema.json')), targetSchema: loadJson(path.join(root, 'kroombox-target-schema.json')), reference: loadJson(path.join(root, 'UNI-VERSE_schema_comparison.json')) });

test('administrator schema bundle is valid and independently reproduces verified counts', () => {
  const { sourceSchema: source, targetSchema: target, reference } = input();
  const result = analyzeBundle({ source, target, reference });
  assert.deepEqual(result.source, { tables: 19, columns: 140, indexParts: 48, foreignKeys: 24 });
  assert.deepEqual(result.target, { tables: 28, columns: 212, indexParts: 87, foreignKeys: 30 });
  assert.equal(result.targetOnly.length, 9);
  assert.equal(result.findings.filter(f => f.code === 'column_collation_difference').length, 62);
  assert.equal(result.findings.filter(f => f.code === 'redundant_foreign_key').length, 2);
  assert.equal(result.findings.filter(f => f.code === 'foreign_key_actions_unavailable').length, 24);
  assert.deepEqual(result.referenceMismatches, []);
  assert.equal(result.ready, false);
  assert.ok(result.findings.every(f => f.evidence.source && f.evidence.target));
  assert.deepEqual(result, analyzeBundle({ source, target, reference }));
});
test('FKs match by relationship, report duplicate source relationships, and require actual actions', () => {
  const { sourceSchema, targetSchema } = input();
  const source = sourceSchema.tables.find(t => t.name === 'tenant_users');
  const target = targetSchema.tables.find(t => t.name === 'tenant_users');
  assert.equal(source.foreignKeys.length, 4);
  assert.equal(target.foreignKeys.length, 2);
  const audit = source.foreignKeys.map(fk => ({ TABLE_NAME: 'tenant_users', CONSTRAINT_NAME: fk.name, on_delete: 'CASCADE', on_update: 'NO ACTION' }));
  const applied = applyForeignKeyActions({ tables: [source] }, audit);
  assert.ok(applied.tables[0].foreignKeys.every(fk => fk.onDelete && fk.onUpdate));
  assert.ok(source.foreignKeys.every(fk => fk.onDelete == null));
  assert.throws(() => compareSchemas({ tables: [source] }, { tables: [target] }, { ignoreAllWarnings: true }));
  assert.throws(() => compareSchemas({ tables: [source] }, { tables: [target] }, { resolutions: [{ object: 'tenant_users.tenant_users_ibfk_1', code: 'redundant_foreign_key', decision: 'accepted_redundant', evidenceFile: __filename, reviewedAt: '2026-11-12', administratorReviewStatus: 'approved' }] }));
  const verified = structuredClone(source);
  for (const fk of verified.foreignKeys) {
    const counterpart = target.foreignKeys.find(t => t.columns.join(',') === fk.columns.join(',') && t.referencedTable === fk.referencedTable);
    fk.onDelete = counterpart.onDelete;
    fk.onUpdate = counterpart.onUpdate;
  }
  const resolutions = ['tenant_users_ibfk_1', 'tenant_users_ibfk_2'].map(name => ({ object: `tenant_users.${name}`, code: 'redundant_foreign_key', decision: 'accepted_redundant', evidenceFile, evidenceSha256, reviewedAt: '2026-11-12', administratorReviewStatus: 'approved' }));
  const resolved = compareSchemas({ tables: [verified] }, { tables: [target] }, { resolutions });
  assert.equal(resolved.counts.requires_review, 0);
  assert.ok(resolved.findings.filter(f => f.resolved).length === 2);
  const missing = compareSchemas({ tables: [verified] }, { tables: [{ ...target, foreignKeys: target.foreignKeys.slice(1) }] });
  assert.ok(missing.findings.some(f => f.code === 'missing_target_foreign_key'));
});
test('record inventories require complete exact counts and correct explicit schema', () => {
  const tables = ['users', 'tenants'];
  assert.equal(validateCountInventory({ environment: 'aiven_v2', schema: 'information_schema', collectedAt: '2026-11-12', counts: { users: 0, tenants: 0 } }, tables, 'aiven_v2').ready, false);
  assert.equal(validateCountInventory({ environment: 'aiven_v2', schema: 'defaultdb', collectedAt: '2026-11-12', counts: { users: 0 } }, tables, 'aiven_v2').ready, false);
  assert.equal(validateCountInventory({ environment: 'aiven_v2', schema: 'defaultdb', collectedAt: '2026-11-12', counts: { users: 0, tenants: 0 } }, tables, 'aiven_v2').ready, true);
});
test('protected local fingerprints reveal only aggregate cross-environment matches', () => {
  const secret = Buffer.alloc(32, 7);
  const a = fingerprintIdentity('Test@Example.invalid ', 'email', secret);
  const b = fingerprintIdentity('test@example.invalid', 'email', secret);
  assert.equal(a, b);
  assert.deepEqual(compareFingerprintSets([a, a], [b]), { sourceDuplicates: 1, targetDuplicates: 0, crossEnvironmentMatches: 1 });
  assert.throws(() => fingerprintIdentity('test@example.invalid', 'email', Buffer.alloc(4)));
  assert.throws(() => compareFingerprintSets(['test@example.invalid'], []));
});
test('evidence requires local files, timestamps, review approval, and all critical checks', () => {
  assert.equal(validateEvidenceManifest({ results: [{ checkId: 'identity_mapping', status: 'passed' }] }).ready, false);
  const results = allChecks.map(checkId => ({ checkId, sourceEnvironment: 'aiven_v2', targetEnvironment: 'kroombox_rehearsal', evidenceFile, evidenceSha256, collectedAt: '2026-11-12T00:00:00Z', status: 'passed', findings: [], administratorReviewStatus: 'approved' }));
  assert.equal(validateEvidenceManifest({ results }).ready, true);
  results[0].evidenceFile = '/not-a-real-evidence-file';
  assert.equal(validateEvidenceManifest({ results }).ready, false);
  results[0].evidenceFile = evidenceFile;
  results[0].administratorReviewStatus = 'pending';
  assert.equal(validateEvidenceManifest({ results }).ready, false);
});
test('offline report is no-go without row counts, mapping and FK actions; no private values leak', () => {
  const report = buildOfflineReport(input());
  assert.equal(report.status, 'no_go');
  assert.ok(report.blockers.includes('identity_mapping_evidence_incomplete'));
  assert.ok(report.blockers.includes('record_inventories_incomplete'));
  assert.equal(report.dependencyOrder.length, 19);
  assert.equal(report.collationRisk.schemaDifferences, 62);
  assert.equal(report.collationRisk.crossEnvironmentEvidence, 'missing');
  assert.doesNotMatch(JSON.stringify(report), /sample-secret@|raw-api-key/);
  assert.deepEqual(report, buildOfflineReport(input()));
});
test('synthetic complete evidence distinguishes review from rehearsal readiness', () => {
  const base = input();
  // Synthetic action values are derived from target metadata only for exercising the gate.
  // They are not claims about the actual Aiven rules.
  const actionRows = base.sourceSchema.tables.flatMap(table => table.foreignKeys.map(fk => {
    const targetTable = base.targetSchema.tables.find(t => t.name === table.name);
    const counterpart = targetTable.foreignKeys.find(other => other.columns.join(',') === fk.columns.join(',') && other.referencedTable === fk.referencedTable && other.referencedColumns.join(',') === fk.referencedColumns.join(','));
    return { TABLE_NAME: table.name, CONSTRAINT_NAME: fk.name, on_delete: counterpart.onDelete, on_update: counterpart.onUpdate };
  }));
  const sourceCounts = Object.fromEntries(base.sourceSchema.tables.map(t => [t.name, 0]));
  const targetCounts = Object.fromEntries(base.targetSchema.tables.map(t => [t.name, 0]));
  const common = { ...base, sourceFkActions: actionRows,
    sourceCounts: { environment: 'aiven_v2', schema: 'defaultdb', collectedAt: '2026-11-12', counts: sourceCounts },
    targetCounts: { environment: 'kroombox_development', schema: 'uniin_universe', collectedAt: '2026-11-12', counts: targetCounts },
    evidence: { results: allChecks.map(checkId => ({ checkId, sourceEnvironment: 'aiven_v2', targetEnvironment: 'kroombox_rehearsal', evidenceFile, evidenceSha256, collectedAt: '2026-11-12', status: 'passed', findings: [], administratorReviewStatus: 'approved' })) },
    mappingEvidence: { evidenceFile, evidenceSha256, collectedAt: '2026-11-12', administratorReviewStatus: 'approved', mappedCounts: sourceCounts } };
  assert.equal(buildOfflineReport(common).status, 'requires_review');
  common.resolutions = ['tenant_users_ibfk_1', 'tenant_users_ibfk_2'].map(name => ({ object: `tenant_users.${name}`, code: 'redundant_foreign_key', decision: 'accepted_redundant', evidenceFile, evidenceSha256, reviewedAt: '2026-11-12', administratorReviewStatus: 'approved' }));
  assert.equal(buildOfflineReport(common).status, 'ready_for_rehearsal');
});
test('local CLI generates a deterministic no-go report without a database client', () => {
  const output = path.join(os.tmpdir(), `foundation4-test-${process.pid}.json`);
  try {
    execFileSync(process.execPath, [path.resolve(__dirname, '../migration/cli.cjs'), `--out=${output}`], { cwd: path.resolve(__dirname, '../..') });
    const report = loadJson(output);
    assert.equal(report.status, 'no_go');
    assert.equal(report.schema.source.tables, 19);
    for (const module of ['inventory.js', 'offlineReport.js', 'rehearsal.js']) {
      const code = fs.readFileSync(path.resolve(__dirname, '../migration', module), 'utf8');
      assert.doesNotMatch(code, /require\(['"](?:mysql2|axios|node:http|node:https)/);
    }
  } finally { fs.rmSync(output, { force: true }); }
});
test('Foundation 4 audit SQL uses explicit schemas and read-only statements', () => {
  for (const [file, schema] of [['aiven-source.sql', 'defaultdb'], ['kroombox-target.sql', 'uniin_universe']]) {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../database/audit/foundation-4', file), 'utf8');
    assert.match(sql, new RegExp('`' + schema + '`'));
    const statements = sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');
    assert.doesNotMatch(statements, /DATABASE\s*\(\s*\)/i);
    assert.doesNotMatch(statements, /`(?:defaultdb|uniin_universe)`\.`(?:defaultdb|uniin_universe)`/i);
    assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|CREATE\s+TABLE)\b/i);
  }
});
