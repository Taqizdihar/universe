const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { auditStructureExport, auditLiveChecksCsv } = require('../migration/rehearsalSchemaAudit');

const root = path.resolve(__dirname, '../../database/migrations/foundation-5b');
const reference = require('../../database/schema-evidence/foundation-4/kroombox-target-schema.json');
const sql = name => fs.readFileSync(path.join(root, name), 'utf8');
const liveChecksCsv = fs.readFileSync(path.resolve(__dirname, '../../database/schema-evidence/foundation-5b/kroombox-live-checks-2026-11-13.csv'), 'utf8');
const evidenceRoot = path.resolve(__dirname, '../../database/schema-evidence/foundation-5b');
const statements = source => source.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');
const evidenceRows = file => {
  const [header, ...rows] = fs.readFileSync(path.join(evidenceRoot, file), 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  const names = header.split('\t').map(name => name.trim()).filter(Boolean);
  return rows.map(row => Object.fromEntries(names.map((name, i) => [name, row.split('\t')[i] ?? ''])));
};
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
test('administrator CHECK inventory matches all 24 historical definitions, and a changed clause blocks review', () => {
  const result = auditLiveChecksCsv(liveChecksCsv);
  assert.equal(result.status, 'verified_against_foundation_2');
  assert.equal(result.observedChecks, 24);
  assert.deepEqual(result.blockers, []);
  const altered = liveChecksCsv.replace('needs_review', 'different_status');
  assert.ok(auditLiveChecksCsv(altered).blockers.includes('check_definition_mismatch'));
  const missing = liveChecksCsv.split(/\r?\n/).slice(0, -2).join('\n');
  assert.ok(auditLiveChecksCsv(missing).blockers.includes('check_inventory_mismatch'));
});
test('administrator live metadata agrees with 53 columns, 28 index parts, and 5 FK definitions', () => {
  const columns = evidenceRows('kroombox-live-columns-2026-11-13.tsv');
  const indexes = evidenceRows('kroombox-live-indexes-2026-11-13.tsv');
  const foreignKeys = evidenceRows('kroombox-live-foreign-keys-2026-11-13.tsv');
  const targets = new Map(reference.tables.map(table => [table.name, table]));
  assert.equal(columns.length, 53);
  assert.equal(indexes.length, 28);
  assert.equal(foreignKeys.length, 5);
  for (const live of columns) {
    const column = targets.get(live.TABLE_NAME)?.columns.find(item => item.name === live.COLUMN_NAME);
    assert.ok(column, `${live.TABLE_NAME}.${live.COLUMN_NAME}`);
    assert.equal(Number(live.ORDINAL_POSITION), column.ordinal);
    assert.equal(live.COLUMN_TYPE.toLowerCase(), column.type.toLowerCase());
    assert.equal(live.IS_NULLABLE === 'YES', column.nullable);
    assert.equal(live.COLUMN_DEFAULT === 'NULL' ? null : live.COLUMN_DEFAULT, column.default);
    assert.equal(live.COLLATION_NAME === 'NULL' ? null : live.COLLATION_NAME, column.collation);
    assert.equal(live.CHARACTER_SET_NAME === 'NULL' ? null : live.CHARACTER_SET_NAME, live.COLLATION_NAME === 'NULL' ? null : live.COLLATION_NAME.split('_')[0]);
    assert.equal(live.GENERATION_EXPRESSION, '');
  }
  for (const table of new Set(columns.map(row => row.TABLE_NAME))) {
    assert.equal(columns.filter(row => row.TABLE_NAME === table).length, targets.get(table).columns.length);
  }
  for (const table of new Set(indexes.map(row => row.TABLE_NAME))) {
    const actual = new Map();
    for (const row of indexes.filter(row => row.TABLE_NAME === table)) actual.set(row.INDEX_NAME, [...(actual.get(row.INDEX_NAME) || []), row]);
    assert.equal(actual.size, targets.get(table).indexes.length);
    for (const [name, parts] of actual) {
      const expected = targets.get(table).indexes.find(item => item.name === name);
      assert.ok(expected, `${table}.${name}`);
      assert.deepEqual(parts.sort((a, b) => Number(a.SEQ_IN_INDEX) - Number(b.SEQ_IN_INDEX)).map(part => part.COLUMN_NAME), expected.columns);
      assert.ok(parts.every(part => (part.NON_UNIQUE === '0') === expected.unique && part.INDEX_TYPE === 'BTREE' && part.SUB_PART === 'NULL' && part.EXPRESSION === 'NULL'));
    }
  }
  for (const live of foreignKeys) {
    const fk = targets.get(live.TABLE_NAME)?.foreignKeys.find(item => item.name === live.CONSTRAINT_NAME);
    assert.ok(fk, `${live.TABLE_NAME}.${live.CONSTRAINT_NAME}`);
    assert.equal(live.REFERENCED_TABLE_SCHEMA, 'uniin_universe');
    assert.deepEqual([live.COLUMN_NAME, live.REFERENCED_TABLE_NAME, live.REFERENCED_COLUMN_NAME, live.DELETE_RULE, live.UPDATE_RULE],
      [fk.columns[0], fk.referencedTable, fk.referencedColumns[0], fk.onDelete, fk.onUpdate]);
  }
  const autoIncrement = columns.filter(row => row.EXTRA.includes('auto_increment')).map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`).sort();
  assert.deepEqual(autoIncrement, ['migration_asset_map.id', 'migration_identity_map.id', 'migration_validation_results.id', 'workspace_compatibility.id']);
});
test('rehearsal schema has reviewed structures and no data or cross-schema DDL', () => {
  const ddl = statements(sql('02_rehearsal_schema.sql'));
  assert.match(ddl, /^USE `uniin_universe_reh`;/m);
  assert.doesNotMatch(ddl, /^\s*(?:INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|DROP|CREATE DATABASE|ALTER DATABASE)\b/im);
  assert.doesNotMatch(ddl, /`(?:defaultdb|uniin_universe)`/);
  assert.equal((ddl.match(/^CREATE TABLE /gm) || []).length, 28);
  assert.equal((ddl.match(/^ALTER TABLE /gm) || []).length, 72);
  assert.equal((ddl.match(/\bCHECK\s*\(/g) || []).length, 24);
  assert.equal((ddl.match(/\bAUTO_INCREMENT;/g) || []).length, 25);
  assert.ok(ddl.lastIndexOf('CREATE TABLE ') < ddl.indexOf('ALTER TABLE '));
  for (const statement of ddl.matchAll(/\b(?:CREATE TABLE|ALTER TABLE|REFERENCES)\s+([^\s(]+)/g)) {
    assert.match(statement[1], /^`uniin_universe_reh`\.`[^`]+`$/);
  }
  const unqualified = ddl.replaceAll('`uniin_universe_reh`.', '').replace(/^USE `uniin_universe_reh`;/m, '');
  const result = auditStructureExport(unqualified, reference);
  assert.equal(result.status, 'structurally_reviewable', JSON.stringify(result.blockers));
  const actualChecks = new Map();
  for (const create of ddl.matchAll(/^CREATE TABLE `uniin_universe_reh`\.`([^`]+)` \(([^]*?)^\) ENGINE=/gm)) {
    for (const check of create[2].matchAll(/CONSTRAINT (chk_[a-z_]+) CHECK \(/g)) actualChecks.set(check[1], create[1]);
  }
  const expectedChecks = new Map(liveChecksCsv.trim().split(/\r?\n/).slice(1).map(line => {
    const [table, name] = line.split(',').slice(0, 2).map(value => value.replaceAll('"', ''));
    return [name, table];
  }));
  assert.deepEqual([...actualChecks].sort(), [...expectedChecks].sort());
  const migrations = ['001_migration_batches.up.sql','002_workspace_compatibility.up.sql','003_migration_identity_map.up.sql','004_migration_validation_results.up.sql','005_migration_asset_map.up.sql'];
  for (const migration of migrations) {
    for (const line of fs.readFileSync(path.resolve(__dirname, '../../database/migrations/foundation-2', migration), 'utf8').split('\n')) {
      if (/^\s*CONSTRAINT chk_/.test(line)) assert.ok(ddl.includes(line.trim().replace(/,$/, '')));
    }
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
  assert.match(sql('01_rehearsal_preflight.sql'), /READY_FOR_MANUAL_IMPORT_AFTER_PASS/);
  assert.match(sql('03_rehearsal_verify.sql'), /REFERENCED_TABLE_SCHEMA<>'uniin_universe_reh'/);
  assert.match(sql('03_rehearsal_verify.sql'), /check_constraint_count/);
  assert.match(sql('03_rehearsal_verify.sql'), /auto_increment_column_count/);
  assert.equal((sql('04_rehearsal_empty_data_check.sql').match(/COUNT\(\*\) AS exact_rows/g) || []).length, 28);
});
test('development audit queries are read-only; offline analyzer cannot connect to a database', () => {
  const audit = statements(sql('00_development_constraints_audit.sql'));
  assert.match(audit, /SHOW CREATE TABLE `uniin_universe`\.`migration_batches`/);
  assert.match(audit, /tc\.CONSTRAINT_SCHEMA = 'uniin_universe' AND tc\.CONSTRAINT_TYPE = 'CHECK'/);
  assert.doesNotMatch(audit, /tc\.TABLE_NAME IN/);
  assert.doesNotMatch(audit.replace(/SHOW CREATE TABLE/g, 'SHOW_TABLE'), /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\s+(?:TABLE|FROM|INTO|\w+\s+SET)\b/i);
  const metadata = statements(sql('00b_development_structure_metadata.sql'));
  assert.match(metadata, /information_schema\.COLUMNS/);
  assert.match(metadata, /information_schema\.STATISTICS/);
  assert.match(metadata, /information_schema\.REFERENTIAL_CONSTRAINTS/);
  assert.equal((metadata.match(/TABLE_SCHEMA='uniin_universe'/g) || []).length, 3);
  assert.doesNotMatch(metadata, /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\s+(?:TABLE|FROM|INTO|\w+\s+SET)\b/i);
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../migration/rehearsalSchemaAudit.js'), 'utf8'), /require\(['"](?:mysql2|axios|node:http|node:https)/);
});
