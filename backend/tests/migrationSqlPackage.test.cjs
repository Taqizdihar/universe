const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../database/migrations/foundation-2');
const files = ['001_migration_batches.up.sql', '002_workspace_compatibility.up.sql', '003_migration_identity_map.up.sql', '004_migration_validation_results.up.sql', '005_migration_asset_map.up.sql'];
const tables = ['migration_batches', 'workspace_compatibility', 'migration_identity_map', 'migration_validation_results', 'migration_asset_map'];
const uncomment = sql => sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');

test('SQL package creates only empty metadata tables in dependency order', () => {
  files.forEach((file, index) => {
    const source = uncomment(fs.readFileSync(path.join(root, file), 'utf8'));
    assert.match(source, new RegExp(`CREATE TABLE IF NOT EXISTS ${tables[index]} \\(`));
    assert.match(source, /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci/);
    assert.doesNotMatch(source, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE\s+(?:TABLE\s+)?\w+|DROP\s+(?:TABLE\s+)?\w+|ALTER\s+TABLE|REPLACE\s+INTO)\b/i);
    assert.doesNotMatch(source, /FOREIGN_KEY_CHECKS/i);
    assert.equal((source.match(/CREATE TABLE/gi) || []).length, 1);
  });
  const map = fs.readFileSync(path.join(root, files[2]), 'utf8');
  assert.match(map, /UNIQUE KEY uq_identity_map_source/);
  assert.match(map, /UNIQUE KEY uq_identity_map_target/);
  assert.match(map, /REFERENCES migration_batches\(batch_id\)/);
});

test('preflight, verification and audit packages contain read-only SQL', () => {
  for (const file of [path.join(root, 'foundation-2.preflight.sql'), path.join(root, 'foundation-2.verify.sql'), path.join(__dirname, '../../database/audit/aiven-v2-schema.sql'), path.join(__dirname, '../../database/audit/kroombox-target-schema.sql'), path.join(__dirname, '../../database/audit/foreign-key-actions.sql')]) {
    const source = uncomment(fs.readFileSync(file, 'utf8'));
    assert.match(source, /information_schema/i);
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|REPLACE|CREATE)\s+(?:TABLE|FROM|INTO|[a-z_]+\s+SET)\b/i);
  }
});
test('verification names every new column and CHECK constraint', () => {
  const verify = fs.readFileSync(path.join(root, 'foundation-2.verify.sql'), 'utf8');
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /CHARACTER SET ascii COLLATE ascii_bin CHARACTER SET/i);
    for (const [, column] of source.matchAll(/^  ([a-z_]+) (?:BIGINT|INT|VARCHAR|CHAR|TEXT|DATETIME)\b/gm)) {
      assert.match(verify, new RegExp(`'${column}'`), `${file}: ${column}`);
    }
    for (const [, constraint] of source.matchAll(/CONSTRAINT (chk_[a-z_]+)/g)) {
      assert.ok(verify.includes(`'${constraint}'`), `${file}: ${constraint}`);
    }
  }
});
