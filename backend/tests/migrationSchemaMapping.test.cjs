const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compareSchemas } = require('../migration/schemaMapping');

const table = () => ({
  name: 'tenant_users', collation: 'utf8mb4_unicode_ci',
  columns: [{ name: 'id', type: 'int', nullable: false, default: null, ordinal: 1, collation: null }],
  indexes: [{ name: 'PRIMARY', columns: ['id'], unique: true, primary: true }],
  foreignKeys: [{ name: 'fk_tenant', columns: ['id'], referencedTable: 'tenants', referencedColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'RESTRICT' }]
});
const sample = () => ({ source: { tables: [table()] }, target: { tables: [table()] } });

test('exact schema match is ready and extra target table is compatible', () => {
  const { source, target } = sample();
  assert.deepEqual(compareSchemas(source, target).counts, { compatible: 0, compatible_with_transformation: 0, requires_review: 0, blocking: 0 });
  target.tables.push({ ...table(), name: 'account_auth_state' });
  const result = compareSchemas(source, target);
  assert.equal(result.ready, true);
  assert.ok(result.findings.some(f => f.code === 'extra_target_table'));
});
test('collation differences require transformation, but missing columns and keys block', () => {
  const { source, target } = sample();
  source.tables[0].collation = 'utf8mb4_0900_ai_ci';
  source.tables[0].columns[0].collation = 'utf8mb4_0900_ai_ci';
  target.tables[0].columns[0].collation = 'utf8mb4_unicode_ci';
  let result = compareSchemas(source, target);
  assert.equal(result.ready, true);
  assert.equal(result.counts.compatible_with_transformation, 2);
  target.tables[0].columns = [];
  target.tables[0].foreignKeys = [];
  result = compareSchemas(source, target);
  assert.equal(result.ready, false);
  assert.ok(result.findings.some(f => f.code === 'missing_target_column'));
  assert.ok(result.findings.some(f => f.code === 'missing_target_foreign_key'));
});
test('missing FK actions, redundant FKs and incomplete metadata prevent readiness', () => {
  const { source, target } = sample();
  delete source.tables[0].foreignKeys[0].onDelete;
  target.tables[0].foreignKeys.push({ ...target.tables[0].foreignKeys[0], name: 'fk_tenant_duplicate' });
  let result = compareSchemas(source, target);
  assert.equal(result.ready, false);
  assert.ok(result.findings.some(f => f.code === 'foreign_key_actions_unavailable'));
  assert.ok(result.findings.some(f => f.code === 'redundant_foreign_key'));
  delete target.tables[0].columns[0].default;
  result = compareSchemas(source, target);
  assert.ok(result.findings.some(f => f.code === 'incomplete_column_metadata'));
  assert.equal(result.ready, false);
});
test('different FK action or index definition blocks migration', () => {
  const { source, target } = sample();
  target.tables[0].foreignKeys[0].onDelete = 'SET NULL';
  target.tables[0].indexes[0].unique = false;
  const result = compareSchemas(source, target);
  assert.ok(result.findings.some(f => f.code === 'foreign_key_action_difference'));
  assert.ok(result.findings.some(f => f.code === 'index_definition_difference'));
  assert.equal(result.ready, false);
});
