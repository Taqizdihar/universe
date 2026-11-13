// Local analysis only. Never emit input SQL, inserted rows, or credentials.
const fs = require('node:fs');
const path = require('node:path');

const foundation2 = path.resolve(__dirname, '../../database/migrations/foundation-2');
const files = ['001_migration_batches.up.sql', '002_workspace_compatibility.up.sql', '003_migration_identity_map.up.sql', '004_migration_validation_results.up.sql', '005_migration_asset_map.up.sql'];

function foundation2Checks() {
    const checks = new Map();
    for (const file of files) {
        const table = file.replace(/^\d+_/, '').replace(/\.up\.sql$/, '');
        const source = fs.readFileSync(path.join(foundation2, file), 'utf8');
        for (const match of source.matchAll(/CONSTRAINT\s+(chk_[a-z_]+)\s+CHECK\s*\(/gi)) {
            let cursor = match.index + match[0].length, depth = 1, quoted = false;
            const start = cursor;
            while (cursor < source.length && depth) {
                if (source[cursor] === "'") quoted = !quoted;
                else if (!quoted && source[cursor] === '(') depth++;
                else if (!quoted && source[cursor] === ')') depth--;
                cursor++;
            }
            if (depth) throw Error(`Unclosed historical CHECK: ${match[1]}`);
            checks.set(match[1], { table, expression: source.slice(start, cursor - 1) });
        }
    }
    return checks;
}

function parseCsvRow(line) {
    const cells = [];
    let value = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
        const character = line[i];
        if (character === '"') {
            if (quoted && line[i + 1] === '"') { value += '"'; i++; }
            else quoted = !quoted;
        } else if (character === ',' && !quoted) { cells.push(value); value = ''; }
        else value += character;
    }
    if (quoted) throw Error('Incomplete CHECK CSV row');
    cells.push(value);
    return cells;
}

function normalizeCheck(expression) {
    return expression.replace(/\\'/g, "'").replace(/_utf8mb4/gi, '')
        .replace(/([a-z_][a-z0-9_]*)\s+REGEXP\s+('[^']*')/gi, 'regexp_like($1,$2)')
        .replace(/[\s()`]/g, '').toLowerCase();
}

function auditLiveChecksCsv(csv) {
    const rows = csv.trim().split(/\r?\n/).map(parseCsvRow);
    if (JSON.stringify(rows.shift()) !== JSON.stringify(['TABLE_NAME', 'CONSTRAINT_NAME', 'CHECK_CLAUSE'])) throw Error('Expected TABLE_NAME,CONSTRAINT_NAME,CHECK_CLAUSE CSV');
    const expected = foundation2Checks();
    const actual = new Map(), duplicateNames = [], unexpectedNames = [], tableDifferences = [], expressionDifferences = [];
    for (const row of rows) {
        if (row.length !== 3) throw Error('Invalid CHECK CSV column count');
        const [table, name, clause] = row;
        if (actual.has(name)) duplicateNames.push(name);
        actual.set(name, { table, clause });
        const historical = expected.get(name);
        if (!historical) unexpectedNames.push(name);
        else {
            if (historical.table !== table) tableDifferences.push(name);
            if (normalizeCheck(historical.expression) !== normalizeCheck(clause)) expressionDifferences.push(name);
        }
    }
    const missingNames = [...expected.keys()].filter(name => !actual.has(name));
    const blockers = [];
    if (rows.length !== expected.size || missingNames.length || unexpectedNames.length || duplicateNames.length) blockers.push('check_inventory_mismatch');
    if (tableDifferences.length || expressionDifferences.length) blockers.push('check_definition_mismatch');
    return { status: blockers.length ? 'blocked' : 'verified_against_foundation_2', observedChecks: rows.length, historicalChecks: expected.size,
        missingNames, unexpectedNames, duplicateNames, tableDifferences, expressionDifferences, blockers };
}

function auditStructureExport(sql, reference) {
    if (typeof sql !== 'string' || !Array.isArray(reference?.tables)) throw TypeError('SQL text and normalized target schema are required.');
    const creates = [...sql.matchAll(/^CREATE TABLE `([^`]+)` \(([^]*?)^\)\s*(ENGINE=[^;]*)?;/gm)];
    const names = creates.map(match => match[1]);
    const expected = new Map(reference.tables.map(table => [table.name, table]));
    const missingTableOptions = [], columnDifferences = [], definitionDifferences = [], unexpectedTables = [];
    let columns = 0;
    for (const match of creates) {
        const [, name, body, options] = match;
        const declarations = [...body.matchAll(/^  `([^`]+)`\s+([^\n]+)$/gm)];
        const actualColumns = declarations.map(entry => entry[1]);
        columns += actualColumns.length;
        if (!options || !/ENGINE=InnoDB\b/.test(options) || !/DEFAULT CHARSET=utf8mb4\b/.test(options) || !/COLLATE=utf8mb4_unicode_ci\b/.test(options)) missingTableOptions.push(name);
        const target = expected.get(name);
        if (!target) unexpectedTables.push(name);
        else {
            if (JSON.stringify(actualColumns) !== JSON.stringify([...target.columns].sort((a, b) => a.ordinal - b.ordinal).map(column => column.name))) columnDifferences.push(name);
            const expectedColumns = new Map(target.columns.map(column => [column.name, column]));
            for (const [, columnName, rawDefinition] of declarations) {
                const column = expectedColumns.get(columnName);
                if (!column) continue;
                const definition = rawDefinition.replace(/,$/, '');
                const typeMatches = definition.toLowerCase().startsWith(column.type.toLowerCase());
                const nullableMatches = column.nullable === !/\bNOT NULL\b/i.test(definition);
                const collationMatches = column.collation == null || new RegExp(`\\bCOLLATE\\s+${column.collation}\\b`, 'i').test(definition);
                const defaultMatch = definition.match(/\bDEFAULT\s+(?:'((?:''|[^'])*)'|([A-Za-z0-9_():.+-]+))/i);
                const actualDefault = defaultMatch ? (defaultMatch[1] ?? defaultMatch[2]) : null;
                const expectedDefault = column.default;
                const defaultMatches = (actualDefault === null || actualDefault?.toUpperCase() === 'NULL') ? expectedDefault == null : String(actualDefault).toUpperCase() === String(expectedDefault).toUpperCase();
                if (!typeMatches || !nullableMatches || !collationMatches || !defaultMatches) definitionDifferences.push(`${name}.${columnName}`);
            }
        }
    }
    const missingTables = reference.tables.filter(table => !names.includes(table.name)).map(table => table.name);
    const intendedChecks = foundation2Checks();
    const insertStatements = (sql.match(/^\s*INSERT\s+INTO\s+/gim) || []).length;
    const otherUnsafeStatements = [...sql.matchAll(/^\s*(DROP|TRUNCATE|REPLACE|UPDATE|DELETE|LOAD|CALL)\b|^\s*(CREATE|ALTER)\s+DATABASE\b|^\s*USE\s+/gim)].map(match => match[1] || (match[2] ? `${match[2]} DATABASE` : 'USE'));
    const checkDefinitions = (sql.match(/\bCHECK\s*\(/gi) || []).length;
    const fkDefinitions = (sql.match(/ADD CONSTRAINT `[^`]+` FOREIGN KEY/g) || []).length;
    const indexDefinitions = [], foreignKeyDefinitions = [];
    for (const alter of sql.matchAll(/^ALTER TABLE `([^`]+)`\s+([^]*?);/gm)) {
        const [, tableName, body] = alter;
        const table = expected.get(tableName);
        if (!table) continue;
        for (const key of body.matchAll(/ADD (PRIMARY KEY|UNIQUE KEY `([^`]+)`|KEY `([^`]+)`) \(([^)]+)\)/g)) {
            const name = key[1] === 'PRIMARY KEY' ? 'PRIMARY' : key[2] || key[3];
            const columns = [...key[4].matchAll(/`([^`]+)`/g)].map(entry => entry[1]);
            indexDefinitions.push({ table: tableName, name, columns, unique: key[1] === 'PRIMARY KEY' || key[1].startsWith('UNIQUE KEY'), primary: key[1] === 'PRIMARY KEY' });
        }
        for (const fk of body.matchAll(/ADD CONSTRAINT `([^`]+)` FOREIGN KEY \(([^)]+)\) REFERENCES `([^`]+)` \(([^)]+)\)(?: ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION))?(?: ON UPDATE (CASCADE|SET NULL|RESTRICT|NO ACTION))?/g)) {
            const columns = [...fk[2].matchAll(/`([^`]+)`/g)].map(entry => entry[1]);
            const referencedColumns = [...fk[4].matchAll(/`([^`]+)`/g)].map(entry => entry[1]);
            foreignKeyDefinitions.push({ table: tableName, name: fk[1], columns, referencedTable: fk[3], referencedColumns, onDelete: fk[5] || 'NO ACTION', onUpdate: fk[6] || 'NO ACTION' });
        }
    }
    const indexDifferences = [];
    for (const table of reference.tables) for (const index of table.indexes) {
        const found = indexDefinitions.find(item => item.table === table.name && item.name === index.name);
        if (!found || JSON.stringify(found.columns) !== JSON.stringify(index.columns) || found.unique !== index.unique || found.primary !== index.primary) indexDifferences.push(`${table.name}.${index.name}`);
    }
    for (const index of indexDefinitions) if (!expected.get(index.table)?.indexes.some(item => item.name === index.name)) indexDifferences.push(`${index.table}.${index.name}`);
    const fkDifferences = [];
    for (const table of reference.tables) for (const fk of table.foreignKeys) {
        const found = foreignKeyDefinitions.find(item => item.table === table.name && item.name === fk.name);
        if (!found || JSON.stringify(found.columns) !== JSON.stringify(fk.columns) || found.referencedTable !== fk.referencedTable || JSON.stringify(found.referencedColumns) !== JSON.stringify(fk.referencedColumns) || found.onDelete !== fk.onDelete || found.onUpdate !== fk.onUpdate) fkDifferences.push(`${table.name}.${fk.name}`);
    }
    for (const fk of foreignKeyDefinitions) if (!expected.get(fk.table)?.foreignKeys.some(item => item.name === fk.name)) fkDifferences.push(`${fk.table}.${fk.name}`);
    const blockers = [];
    if (names.length !== 28 || new Set(names).size !== names.length || missingTables.length || unexpectedTables.length || columnDifferences.length || definitionDifferences.length || columns !== 212) blockers.push('table_or_column_inventory_mismatch');
    if (missingTableOptions.length) blockers.push('table_options_missing');
    if (checkDefinitions < intendedChecks.size) blockers.push('check_constraints_unverifiable');
    if (fkDefinitions !== 30) blockers.push('foreign_key_inventory_mismatch');
    if (fkDifferences.length) blockers.push('foreign_key_definition_mismatch');
    if (indexDefinitions.reduce((n, entry) => n + entry.columns.length, 0) !== 87 || indexDifferences.length) blockers.push('index_definition_mismatch');
    if (insertStatements) blockers.push('source_export_contains_dml');
    if (otherUnsafeStatements.length) blockers.push('source_export_contains_unsafe_statements');
    return { status: blockers.length ? 'blocked' : 'structurally_reviewable', tables: names.length, columns, foreignKeys: fkDefinitions,
        checkDefinitions, intendedFoundation2Checks: intendedChecks.size, insertStatements, otherUnsafeStatements: [...new Set(otherUnsafeStatements)].sort(),
        missingTableOptions: missingTableOptions.sort(), missingTables, unexpectedTables, columnDifferences,
        definitionDifferences: definitionDifferences.sort(), indexDifferences: indexDifferences.sort(), fkDifferences: fkDifferences.sort(),
        blockers: blockers.sort() };
}
module.exports = { auditStructureExport, auditLiveChecksCsv };
