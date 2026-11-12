const assert = require('node:assert/strict');
const { test } = require('node:test');
const { entities } = require('../migration/planner');
const { assessRehearsal, generateDependencyPlan, requiredChecks } = require('../migration/rehearsal');

const sample = () => {
  const legacyTables = [...Object.keys(entities).filter(t => !['super_admin_verifications', 'update_images', 'update_history'].includes(t)), 'update_history'];
  const source = Object.fromEntries(legacyTables.map(table => [table, []]));
  source.users.push({ id: 1, emailFingerprint: 'digest-user-1' });
  source.tenants.push({ id: 1, subdomain: 'synthetic-site' });
  source.tenant_users.push({ id: 2, tenant_id: 1, user_id: 1, role: 'admin' });
  source.api_keys.push({ id: 3, tenant_id: 1, fingerprint: 'digest-key-1' });
  const schemaTable = name => ({ name, collation: 'utf8mb4_unicode_ci', columns: [{ name: 'id', type: 'int', nullable: false, default: null, ordinal: 1, collation: null }], indexes: [{ name: 'PRIMARY', columns: ['id'], unique: true, primary: true }], foreignKeys: [] });
  return { batchId: 'synthetic-3', sourceSystem: 'aiven_v2', targetEnvironment: 'kroombox_staging', legacyTables,
    sourceSchema: { tables: legacyTables.map(schemaTable) }, targetSchema: { tables: legacyTables.map(schemaTable).concat(schemaTable('account_auth_state')) }, source,
    target: { users: [{ id: 26, emailFingerprint: 'digest-super-admin' }], user_global_roles: [{ user_id: 26, role: 'super_admin' }] },
    mappings: [{ entity: 'users', sourceId: 1, targetId: 27 }, { entity: 'tenants', sourceId: 1, targetId: 15 },
      { entity: 'tenant_users', sourceId: 2, targetId: 28, sourceUserId: 1, sourceTenantId: 1, targetTenantId: 15 },
      { entity: 'api_keys', sourceId: 3, targetId: 52, sourceTenantId: 1, targetTenantId: 15 }], validationResults: requiredChecks.map(checkId => ({ checkId, status: 'passed' })) };
};
test('explicit 19-table plan is dependency aware and deterministic', () => {
  const input = sample();
  const steps = generateDependencyPlan(input.legacyTables);
  assert.equal(steps.length, 19);
  assert.ok(steps.find(s => s.table === 'users').order < steps.find(s => s.table === 'tenant_users').order);
  assert.ok(steps.find(s => s.table === 'tenants').order < steps.find(s => s.table === 'api_keys').order);
  assert.deepEqual(assessRehearsal(input), assessRehearsal(input));
  assert.equal(assessRehearsal(input).go, true);
  assert.doesNotMatch(JSON.stringify(assessRehearsal(input)), /digest-user-1|digest-key-1/);
});
test('unknown schema, missing inventory, validation or mapping blocks', () => {
  const input = sample();
  input.sourceSchema.tables[0].foreignKeys = [{ name: 'missing_actions', columns: ['id'], referencedTable: 'tenants', referencedColumns: ['id'] }];
  input.mappings.pop();
  input.validationResults = [{ status: 'failed' }];
  delete input.source.posts;
  const codes = assessRehearsal(input).blockers.map(f => f.code);
  for (const code of ['schema_mapping_not_ready', 'missing_source_inventory', 'missing_identity_map', 'validation_incomplete']) assert.ok(codes.includes(code), code);
  assert.equal(assessRehearsal(input).go, false);
});
test('collisions, cross-tenant content, nested media and protected admin are no-go', () => {
  const input = sample();
  input.source.users.push({ id: 2, emailFingerprint: 'digest-user-1' });
  input.source.tenants.push({ id: 2, subdomain: 'synthetic-site' });
  input.source.post_categories.push({ id: 5, tenant_id: 2 });
  input.source.posts.push({ id: 7, tenant_id: 1, category_id: 5, slug: 'news', nestedMediaReferenceCount: 1 });
  input.source.posts.push({ id: 8, tenant_id: 1, slug: 'news' });
  input.mappings[0].targetId = 26;
  const report = assessRehearsal(input);
  const codes = report.blockers.map(f => f.code);
  for (const code of ['duplicate_emailFingerprint_identity', 'duplicate_subdomain_identity', 'cross_tenant_post_categories_reference', 'duplicate_tenant_slug', 'protected_super_admin']) assert.ok(codes.includes(code), code);
  assert.ok(report.review.some(f => f.code === 'nested_media_reference_review'));
  assert.equal(report.go, false);
});
test('protected authentication data is excluded from a table roster', () => {
  const tables = sample().legacyTables.slice(0, 18).concat('super_admin_verifications');
  assert.equal(generateDependencyPlan(tables).find(s => s.table === 'super_admin_verifications').action, 'exclude_from_transfer');
});
