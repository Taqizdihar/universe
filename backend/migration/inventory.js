const fs = require('node:fs');
const path = require('node:path');
const { compareSchemas } = require('./schemaMapping');

function loadJson(file) {
    if (!file || !path.isAbsolute(file)) throw TypeError('A local absolute file path is required.');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function validateSchema(schema) {
    if (!Array.isArray(schema?.tables) || !schema.tables.length) throw TypeError('Schema tables are missing.');
    for (const table of schema.tables) {
        if (!table?.name || !table.collation || !Array.isArray(table.columns) || !Array.isArray(table.indexes) || !Array.isArray(table.foreignKeys)) throw TypeError('Incomplete schema table metadata.');
    }
    return schema;
}
function stats(schema) {
    return { tables: schema.tables.length, columns: schema.tables.reduce((n, t) => n + t.columns.length, 0), indexParts: schema.tables.reduce((n, t) => n + t.indexes.reduce((m, i) => m + i.columns.length, 0), 0), foreignKeys: schema.tables.reduce((n, t) => n + t.foreignKeys.length, 0) };
}
function pointer(schema, object) {
    const [tableName, member] = object.split('.');
    const tableIndex = schema.tables.findIndex(table => table.name === tableName);
    if (tableIndex < 0) return '#/tables';
    const table = schema.tables[tableIndex];
    if (!member) return `#/tables/${tableIndex}`;
    for (const section of ['columns', 'indexes', 'foreignKeys']) {
        const index = table[section].findIndex(item => item.name === member);
        if (index >= 0) return `#/tables/${tableIndex}/${section}/${index}`;
    }
    return `#/tables/${tableIndex}`;
}
function analyzeBundle({ source, target, reference, sourceFile = 'aiven-source-schema.json', targetFile = 'kroombox-target-schema.json', resolutions = [] }) {
    validateSchema(source); validateSchema(target);
    const sourceStats = stats(source), targetStats = stats(target);
    const sourceNames = new Set(source.tables.map(t => t.name));
    const targetOnly = target.tables.filter(t => !sourceNames.has(t.name)).map(t => t.name).sort();
    const report = compareSchemas(source, target, { resolutions });
    const findings = report.findings.map(f => ({ ...f, evidence: { source: `${sourceFile}${pointer(source, f.object)}`, target: `${targetFile}${pointer(target, f.object)}` } }));
    const comparisons = [
        ['aiven_tables', sourceStats.tables], ['kroombox_tables', targetStats.tables],
        ['aiven_columns', sourceStats.columns], ['kroombox_columns', targetStats.columns],
        ['source_index_parts', sourceStats.indexParts], ['aiven_foreign_keys', sourceStats.foreignKeys],
        ['differences_column_collations', findings.filter(f => f.code === 'column_collation_difference').length]
    ];
    const referenceMismatches = reference ? comparisons.filter(([field, actual]) => reference.counts?.[field] !== actual).map(([field, actual]) => ({ field, actual, reference: reference.counts?.[field] })) : [];
    if (reference && (!Array.isArray(reference.target_only_tables) || JSON.stringify([...reference.target_only_tables].sort()) !== JSON.stringify(targetOnly))) referenceMismatches.push({ field: 'target_only_tables' });
    return { source: sourceStats, target: targetStats, targetOnly, counts: report.counts, ready: report.ready && sourceStats.tables === 19 && targetOnly.length === 9 && referenceMismatches.length === 0,
        referenceMismatches, findings, summary: `Source ${sourceStats.tables} tables/${sourceStats.columns} columns; target ${targetStats.tables} tables; ${targetOnly.length} target-only; ${report.counts.compatible_with_transformation} transformation findings; ${report.counts.requires_review} unresolved reviews; ${report.counts.blocking} blockers.` };
}
module.exports = { loadJson, validateSchema, stats, analyzeBundle };
