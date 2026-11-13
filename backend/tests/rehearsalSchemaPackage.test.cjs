const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { auditStructureExport } = require('../migration/rehearsalSchemaAudit');

const root = path.resolve(__dirname, '../../database/migrations/foundation-5b');
const reference = require('../../database/schema-evidence/foundation-4/kroombox-target-schema.json');
const sql = name => fs.readFileSync(path.join(root, name), 'utf8');
const statements = source => source.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');
function syntheticExport() {
  const creates = reference.tables.map((table, tableIndex) => {
    const columns = [...table.columns].sort((a, b) => a.ordinal - b.ordinal).map(column => {
      const defaultValue = column.default == null ? '' : /^CURRENT_TIMESTAMP(?:\(6\))?$/.test(column.default) ? ` DEFAULT ${column.default}` : ` DEFAULT '${column.default}'`;
      return `  \`${column.name}\` ${column.type}${column.collation ? ` COLLATE ${column.collation}` : ''}${column.nullable ? '' : ' NOT NULL'}${defaultValue}`;
    });
    if (tableIndex === 0) for (let i = 0; i < 24; i++) columns.push(`  CONSTRAINT \`chk_synthetic_${i}\` CHECK (1=1)`);
    return `CREATE TABLE \`${table.name}\` (\n${columns.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;
  });
  const indexes = reference.tables.flatMap(table => table.indexes.map(index => {
    const kind = index.primary ? 'PRIMARY KEY' : index.unique ? `UNIQUE KEY \`${index.name}\`` : `KEY \`${index.name}\``;
    return `ALTER TABLE \`${table.name}\` ADD ${kind} (${index.columns.map(column => `\`${column}\``).join(',')});`;
  }));
  const fks = reference.tables.flatMap(table => table.foreignKeys.map(fk => `ALTER TABLE \`${table.name}\` ADD CONSTRAINT \`${fk.name}\` FOREIGN KEY (${fk.columns.map(column => `\`${column}\``).join(',')}) REFERENCES \`${fk.referencedTable}\` (${fk.referencedColumns.map(column => `\`${column}\``).join(',')}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate};`));
  return [...creates, ...indexes, ...fks].join('\n');
}
test('synthetic complete structural source is reviewable; omissions and DML fail closed', () => {
  const complete = syntheticExport();
  assert.equal(auditStructureExport(complete, reference).status, 'structurally_reviewable');
  const contaminated = `${complete}\nINSERT INTO \`users\` VALUES (1);`;
  assert.ok(auditStructureExport(contaminated, reference).blockers.includes('source_export_contains_dml'));
  assert.ok(auditStructureExport(`${complete}\nDROP TABLE \`users\`;`, reference).blockers.includes('source_export_contains_unsafe_statements'));
  const missingOptions = complete.replace('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;', ';');
  assert.ok(auditStructureExport(missingOptions, reference).blockers.includes('table_options_missing'));
  const missingChecks = complete.replace(/,\n  CONSTRAINT `chk_synthetic_\d+` CHECK \(1=1\)/g, '');
  assert.ok(auditStructureExport(missingChecks, reference).blockers.includes('check_constraints_unverifiable'));
  const wrongColumn = complete.replace('`version` bigint unsigned', '`version` varchar(20)');
  assert.ok(auditStructureExport(wrongColumn, reference).blockers.includes('table_or_column_inventory_mismatch'));
  const uniqueIndex = reference.tables.flatMap(table => table.indexes.map(index => ({ table: table.name, index }))).find(entry => entry.index.unique && !entry.index.primary);
  const weakenedUnique = complete.replace(`ALTER TABLE \`${uniqueIndex.table}\` ADD UNIQUE KEY \`${uniqueIndex.index.name}\``, `ALTER TABLE \`${uniqueIndex.table}\` ADD KEY \`${uniqueIndex.index.name}\``);
  assert.ok(auditStructureExport(weakenedUnique, reference).blockers.includes('index_definition_mismatch'));
  const missingForeignKey = complete.replace(/^ALTER TABLE `[^`]+` ADD CONSTRAINT `[^`]+` FOREIGN KEY[^\n]+\n/m, '');
  assert.ok(auditStructureExport(missingForeignKey, reference).blockers.includes('foreign_key_definition_mismatch'));
});
test('offline CLI never echoes authentication rows from an impure export', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-audit-'));
  try {
    const source = path.join(dir, 'fixture.sql');
    const canary = 'private-auth-canary@example.invalid';
    fs.writeFileSync(source, `${syntheticExport()}\nINSERT INTO \`users\` VALUES ('${canary}');`);
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../migration/rehearsalSchemaAudit.cjs'), `--source=${source}`], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).status, 'blocked');
    assert.ok(!`${result.stdout}${result.stderr}`.includes(canary));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('preflight and verification are explicitly bound to approved rehearsal schema', () => {
  const files = ['01_rehearsal_preflight.sql', '03_rehearsal_verify.sql', '04_rehearsal_empty_data_check.sql'];
  for (const file of files) {
    const source = statements(sql(file));
    assert.match(source, /USE `uniin_universe_reh`;/);
    assert.doesNotMatch(source, /`(?:defaultdb|uniin_universe)`\./);
    assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\s+(?:TABLE|FROM|INTO|\w+\s+SET)\b/i);
  }
  assert.match(sql('01_rehearsal_preflight.sql'), /PASS_EMPTY_REHEARSAL_SCHEMA/);
  assert.match(sql('03_rehearsal_verify.sql'), /REFERENCED_TABLE_SCHEMA<>'uniin_universe_reh'/);
  assert.match(sql('03_rehearsal_verify.sql'), /check_constraint_count/);
  assert.match(sql('03_rehearsal_verify.sql'), /auto_increment_column_count/);
  assert.equal((sql('04_rehearsal_empty_data_check.sql').match(/COUNT\(\*\) AS exact_rows/g) || []).length, 28);
});
test('source constraints audit is read-only; schema import is intentionally blocked', () => {
  const audit = statements(sql('00_development_constraints_audit.sql'));
  assert.match(audit, /SHOW CREATE TABLE `uniin_universe`\.`migration_batches`/);
  assert.match(audit, /tc\.CONSTRAINT_SCHEMA = 'uniin_universe' AND tc\.CONSTRAINT_TYPE = 'CHECK'/);
  assert.doesNotMatch(audit, /tc\.TABLE_NAME IN/);
  assert.doesNotMatch(audit.replace(/SHOW CREATE TABLE/g, 'SHOW_TABLE'), /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\s+(?:TABLE|FROM|INTO|\w+\s+SET)\b/i);
  const blocked = statements(sql('02_rehearsal_schema.sql'));
  assert.match(blocked, /BLOCKED_UNVERIFIED_SCHEMA_EXPORT/);
  assert.doesNotMatch(blocked, /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\s+(?:TABLE|FROM|INTO|\w+\s+SET)\b/i);
  assert.doesNotMatch(blocked, /\b(?:defaultdb|uniin_universe)\b/i);
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../migration/rehearsalSchemaAudit.js'), 'utf8'), /require\(['"](?:mysql2|axios|node:http|node:https)/);
});
