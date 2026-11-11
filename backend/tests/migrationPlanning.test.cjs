const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const p = require('../migration/planner');
const sample = () => ({
  batchId: 'synthetic-batch', sourceSystem: 'aiven_v2', targetEnvironment: 'kroombox_staging',
  source: { users: [{ id: 1, email: 'a@example.test' }], tenants: [{ id: 1, subdomain: 'sample-a' }], tenant_users: [{ id: 8, tenant_id: 1, user_id: 1, role: 'admin' }], api_keys: [{ id: 5, tenant_id: 1, fingerprint: 'test-fingerprint-a' }] },
  target: { users: [{ id: 1, email: 'different@example.test' }, { id: 26, email: 'owner@example.test' }], tenants: [{ id: 15, subdomain: 'target-site' }], user_global_roles: [{ user_id: 26, role: 'super_admin' }], api_keys: [{ id: 51, tenant_id: 15, fingerprint: 'test-fingerprint-b' }] },
  mappings: [{ entity: 'tenants', sourceId: 1, targetId: 15 }, { entity: 'users', sourceId: 1, targetId: 27 }, { entity: 'tenant_users', sourceId: 8, targetId: 28, sourceTenantId: 1, targetTenantId: 15, sourceUserId: 1 }, { entity: 'api_keys', sourceId: 5, targetId: 52, sourceTenantId: 1, targetTenantId: 15 }],
  validationResults: [{ status: 'passed' }]
});
test('workspace metadata uses safe defaults and validates verification prerequisites', () => {
  assert.deepEqual(p.validateWorkspaceCompatibility({ tenantId: 15 }), { tenantId: '15', originSystem: 'kroombox_native', contentMode: 'legacy_compatible', apiContractVersion: 'legacy-api-v1', migrationBatchId: null, verifiedAt: null });
  assert.throws(() => p.validateWorkspaceCompatibility({ tenantId: 15, contentMode: 'unknown' }));
  assert.throws(() => p.validateWorkspaceCompatibility({ tenantId: 15, verifiedAt: '2026-01-01' }));
});
test('batch statuses require validation, human approval and manual application evidence', () => {
  const planned = { status: 'planned' };
  const prepared = p.transitionBatchStatus(planned, 'prepared');
  assert.throws(() => p.transitionBatchStatus(prepared, 'validated', { validationResults: [{ status: 'failed' }] }));
  assert.throws(() => p.transitionBatchStatus(prepared, 'validated', { validationResults: [] }));
  const validated = p.transitionBatchStatus(prepared, 'validated', { validationResults: [{ status: 'passed' }] });
  assert.throws(() => p.transitionBatchStatus(validated, 'approved'));
  const approved = p.transitionBatchStatus(validated, 'approved', { approvalReference: 'review-1' });
  assert.throws(() => p.transitionBatchStatus(approved, 'applied'));
  assert.equal(p.transitionBatchStatus(approved, 'applied', { applicationReference: 'manual-phpmyadmin-1' }).status, 'applied');
  assert.equal(p.summarizeValidations([{ status: 'passed' }, { status: 'pending' }]).ready, false);
});
test('planner never auto-merges numeric IDs, emails or protected Super Admin', () => {
  const input = sample();
  assert.deepEqual(p.planMigration(input), p.planMigration(input));
  assert.ok(p.planMigration(input).conflicts.some(c => c.type === 'numeric_id_collision'));
  input.source.users[0].email = 'owner@example.test';
  input.mappings[1].targetId = 26;
  const conflicts = p.planMigration(input).conflicts.map(c => c.type);
  assert.ok(conflicts.includes('email_match_requires_review'));
  assert.ok(conflicts.includes('protected_super_admin'));
  assert.equal(p.planMigration(input).status, 'needs_review');
  assert.equal(JSON.stringify(p.planMigration(input)).includes('owner@example.test'), false);
});
test('duplicate mappings, subdomains, API keys and cross-tenant membership are flagged', () => {
  const input = sample();
  input.target.tenants.push({ id: 16, subdomain: 'sample-a' });
  input.target.api_keys.push({ id: 52, tenant_id: 16, fingerprint: 'test-fingerprint-a' });
  input.mappings.push({ entity: 'users', sourceId: 1, targetId: 27 });
  input.mappings[2].targetTenantId = 16;
  input.mappings[3].targetId = 52;
  const types = p.planMigration(input).conflicts.map(c => c.type);
  for (const type of ['duplicate_source_mapping', 'duplicate_target_mapping', 'subdomain_collision', 'api_key_collision', 'api_key_ownership_conflict', 'cross_tenant_mapping']) assert.ok(types.includes(type), type);
});
test('missing references and dependency order are explicit', () => {
  const input = sample();
  input.source.posts = [{ id: 9, tenant_id: 1, category_id: 88, featured_image_id: 99 }];
  const types = p.planMigration(input).conflicts.map(c => c.type);
  assert.ok(types.includes('missing_post_categories_reference'));
  assert.ok(types.includes('missing_media_reference'));
  const order = p.dependencyOrder(['posts', 'media', 'tenants', 'post_categories', 'users']);
  assert.ok(order.indexOf('tenants') < order.indexOf('posts'));
  assert.ok(order.indexOf('media') < order.indexOf('posts'));
  assert.ok(order.indexOf('post_categories') < order.indexOf('posts'));
});
test('cross-tenant content, global roles and absent mapping identities require review', () => {
  const input = sample();
  input.source.tenants.push({ id: 2, subdomain: 'sample-b' });
  input.source.users.push({ id: 2, email: 'member@example.test' });
  input.source.tenant_users.push({ id: 9, tenant_id: 2, user_id: 1, role: 'guest' });
  input.source.post_categories = [{ id: 10, tenant_id: 2 }];
  input.source.posts = [{ id: 20, tenant_id: 1, category_id: 10 }];
  input.source.user_global_roles = [{ id: 30, user_id: 2, role: 'admin' }];
  input.mappings.push({ entity: 'posts', sourceId: 999, targetId: 1000 });
  const types = p.planMigration(input).conflicts.map(c => c.type);
  assert.ok(types.includes('cross_tenant_post_categories_reference'));
  assert.ok(types.includes('global_role_requires_review'));
  assert.ok(types.includes('missing_source_record'));
  assert.equal(input.source.tenant_users.length, 2);
  assert.equal(p.planMigration(input).status, 'needs_review');
});
test('source identities and recovery data cannot be smuggled into a plan', () => {
  const input = sample();
  input.source.users[0].id = -1;
  assert.throws(() => p.planMigration(input));
  input.source.users[0].id = 1;
  input.source.password_reset_tokens = [{ id: 1 }];
  assert.throws(() => p.planMigration(input));
});
test('asset plan keeps IDs and types only, never URLs or files', () => {
  const result = p.planAssetMappings([{ sourceMediaId: 11, targetMediaId: 99, sourceReferenceType: 'db_media_id', sourceUrl: 'https://cdn.example.test/test.jpg' }]);
  assert.deepEqual(result, [{ sourceMediaId: '11', targetMediaId: '99', sourceReferenceType: 'db_media_id', mappingStatus: 'proposed', verificationStatus: 'pending' }]);
  assert.throws(() => p.planAssetMappings([{ sourceMediaId: 11, sourceReferenceType: 'db_media_id' }, { sourceMediaId: 11, sourceReferenceType: 'db_media_id' }]));
});
test('planner rejects raw secrets and contains no database or schema execution path', () => {
  assert.throws(() => p.planMigration({ ...sample(), source: { users: [{ id: 1, password_hash: 'secret' }] } }));
  assert.throws(() => p.planMigration({ ...sample(), source: { api_keys: [{ api_key: 'secret' }] } }));
  const code = fs.readFileSync(path.join(__dirname, '../migration/planner.js'), 'utf8');
  assert.doesNotMatch(code, /require\(['"](?:mysql2|\.\.\/server\/lib\/db)/);
  assert.doesNotMatch(code, /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\s+(?:TABLE|FROM|INTO|[a-z_]+\s+SET)\b/i);
});
