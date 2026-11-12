// Pure, offline schema comparison. Inputs are administrator-exported metadata, never table rows.
const levels = ['compatible', 'compatible_with_transformation', 'requires_review', 'blocking'];
const sort = rows => rows.sort((a, b) => `${a.object}:${a.code}`.localeCompare(`${b.object}:${b.code}`));
const key = value => String(value || '').toLowerCase();
const has = (object, field) => Object.prototype.hasOwnProperty.call(object, field);

function compareSchemas(source, target) {
    if (!Array.isArray(source?.tables) || !Array.isArray(target?.tables)) throw TypeError('Both schema table inventories are required.');
    const findings = [];
    const add = (object, code, classification) => findings.push({ object, code, classification });
    const tables = new Map();
    for (const table of target.tables) {
        if (!table?.name || tables.has(key(table.name))) throw TypeError('Invalid or duplicate target table metadata.');
        tables.set(key(table.name), table);
    }
    const seenSource = new Set();
    for (const sourceTable of source.tables) {
        if (!sourceTable?.name || seenSource.has(key(sourceTable.name))) throw TypeError('Invalid or duplicate source table metadata.');
        seenSource.add(key(sourceTable.name));
        const name = sourceTable.name;
        const targetTable = tables.get(key(name));
        if (!targetTable) { add(name, 'missing_target_table', 'blocking'); continue; }
        for (const side of [sourceTable, targetTable]) {
            if (!side.collation || !Array.isArray(side.columns) || side.columns.length === 0 || !Array.isArray(side.indexes) || !Array.isArray(side.foreignKeys)) add(name, 'incomplete_table_metadata', 'blocking');
        }
        if (!has(sourceTable, 'collation') || !has(targetTable, 'collation')) continue;
        if (sourceTable.collation !== targetTable.collation) add(name, 'table_collation_difference', 'compatible_with_transformation');
        const targetColumns = new Map((targetTable.columns || []).map(c => [key(c.name), c]));
        for (const col of sourceTable.columns || []) {
            const path = `${name}.${col.name}`;
            const other = targetColumns.get(key(col.name));
            if (!other) { add(path, 'missing_target_column', 'blocking'); continue; }
            if (![col, other].every(c => has(c, 'type') && has(c, 'nullable') && has(c, 'default') && has(c, 'ordinal') && has(c, 'collation'))) { add(path, 'incomplete_column_metadata', 'blocking'); continue; }
            if (key(col.type) !== key(other.type) || col.nullable !== other.nullable || col.default !== other.default || col.ordinal !== other.ordinal) add(path, 'column_definition_difference', 'blocking');
            if (col.collation !== other.collation) add(path, 'column_collation_difference', 'compatible_with_transformation');
        }
        for (const col of targetTable.columns || []) if (!(sourceTable.columns || []).some(c => key(c.name) === key(col.name))) add(`${name}.${col.name}`, 'extra_target_column', 'compatible');
        const signature = index => JSON.stringify({ columns: index.columns?.map(key), unique: index.unique, primary: index.primary });
        for (const side of [sourceTable, targetTable]) for (const index of side.indexes || []) if (!Array.isArray(index.columns) || !has(index, 'unique') || !has(index, 'primary') || !index.name) add(name, 'incomplete_index_metadata', 'blocking');
        const targetIndexes = new Map((targetTable.indexes || []).map(i => [key(i.name), i]));
        for (const index of sourceTable.indexes || []) {
            const other = targetIndexes.get(key(index.name));
            if (!other) add(`${name}.${index.name}`, 'missing_target_index', 'blocking');
            else if (signature(index) !== signature(other)) add(`${name}.${index.name}`, 'index_definition_difference', 'blocking');
        }
        for (const index of targetTable.indexes || []) if (!(sourceTable.indexes || []).some(i => key(i.name) === key(index.name))) add(`${name}.${index.name}`, 'extra_target_index', 'compatible');
        const fkSignature = fk => JSON.stringify({ columns: fk.columns?.map(key), table: key(fk.referencedTable), references: fk.referencedColumns?.map(key) });
        const targetFks = targetTable.foreignKeys || [];
        for (const side of [sourceTable, targetTable]) for (const fk of side.foreignKeys || []) {
            if (!fk.name || !Array.isArray(fk.columns) || !fk.referencedTable || !Array.isArray(fk.referencedColumns)) add(name, 'incomplete_foreign_key_metadata', 'blocking');
        }
        for (const fk of sourceTable.foreignKeys || []) {
            const path = `${name}.${fk.name}`;
            const other = targetFks.find(candidate => fkSignature(candidate) === fkSignature(fk));
            if (!other) { add(path, 'missing_target_foreign_key', 'blocking'); continue; }
            if (!fk.onDelete || !fk.onUpdate || !other.onDelete || !other.onUpdate) add(path, 'foreign_key_actions_unavailable', 'requires_review');
            else if (key(fk.onDelete) !== key(other.onDelete) || key(fk.onUpdate) !== key(other.onUpdate)) add(path, 'foreign_key_action_difference', 'blocking');
            if (targetFks.filter(candidate => fkSignature(candidate) === fkSignature(fk)).length > 1 || (sourceTable.foreignKeys || []).filter(candidate => fkSignature(candidate) === fkSignature(fk)).length > 1) add(path, 'redundant_foreign_key', 'requires_review');
        }
        for (const fk of targetFks) if (!(sourceTable.foreignKeys || []).some(candidate => fkSignature(candidate) === fkSignature(fk))) add(`${name}.${fk.name}`, 'extra_target_foreign_key', 'requires_review');
    }
    for (const table of target.tables) if (!seenSource.has(key(table.name))) add(table.name, 'extra_target_table', 'compatible');
    const counts = Object.fromEntries(levels.map(level => [level, findings.filter(f => f.classification === level).length]));
    return { ready: source.tables.length > 0 && counts.blocking === 0 && counts.requires_review === 0, counts, findings: sort(findings) };
}

module.exports = { compareSchemas };
