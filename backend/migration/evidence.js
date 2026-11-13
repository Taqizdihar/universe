const { validEvidenceFile } = require('./fileEvidence');
const { requiredChecks } = require('./rehearsal');
const additionalChecks = Object.freeze(['source_collation_collisions', 'cross_environment_collisions', 'ordering_behavior']);
const allChecks = Object.freeze([...requiredChecks, ...additionalChecks]);

function validateEvidenceManifest(manifest) {
    if (!Array.isArray(manifest?.results)) throw TypeError('Evidence results are required.');
    const missing = [], invalid = [], seen = new Set();
    for (const result of manifest.results) {
        const id = result?.checkId;
        if (!allChecks.includes(id) || seen.has(id)) { invalid.push(id || 'unknown'); continue; }
        seen.add(id);
        const file = result?.evidenceFile;
        if (result?.sourceEnvironment !== 'aiven_v2' || result?.targetEnvironment !== 'kroombox_rehearsal' || !validEvidenceFile(file, result.evidenceSha256, id) || !result.collectedAt || !Number.isFinite(Date.parse(result.collectedAt)) || !Array.isArray(result.findings) || !['passed', 'failed', 'pending'].includes(result.status) || !['approved', 'pending', 'rejected'].includes(result.administratorReviewStatus)) invalid.push(id);
        if (result?.status === 'passed' && (result.administratorReviewStatus !== 'approved' || !Array.isArray(result.findings) || result.findings.length > 0)) invalid.push(id);
    }
    for (const id of allChecks) if (!seen.has(id)) missing.push(id);
    return { ready: missing.length === 0 && invalid.length === 0 && manifest.results.every(r => r?.status === 'passed'), missing, invalid: [...new Set(invalid)].sort(), failed: manifest.results.filter(r => r?.status !== 'passed').map(r => r?.checkId || 'unknown').sort() };
}
function validateCountInventory(inventory, tables, environment) {
    const missing = [];
    const expectedSchema = environment === 'aiven_v2' ? 'defaultdb' : 'uniin_universe';
    if (inventory?.environment !== environment || inventory?.schema !== expectedSchema || !inventory.collectedAt || !Number.isFinite(Date.parse(inventory.collectedAt)) || typeof inventory.counts !== 'object' || !inventory.counts) missing.push('inventory_header');
    for (const table of tables) if (!Number.isSafeInteger(inventory?.counts?.[table]) || inventory.counts[table] < 0) missing.push(`count:${table}`);
    return { ready: missing.length === 0, missing };
}
function applyForeignKeyActions(schema, rows) {
    if (!Array.isArray(rows)) throw TypeError('Foreign-key action audit rows are required.');
    const copy = structuredClone(schema);
    const index = new Map(rows.map(row => [`${row.TABLE_NAME || row.table}.${row.CONSTRAINT_NAME || row.constraint}`, row]));
    for (const table of copy.tables) for (const fk of table.foreignKeys) {
        const row = index.get(`${table.name}.${fk.name}`);
        if (row && (row.on_delete || row.DELETE_RULE) && (row.on_update || row.UPDATE_RULE)) {
            fk.onDelete = row.on_delete || row.DELETE_RULE;
            fk.onUpdate = row.on_update || row.UPDATE_RULE;
        }
    }
    return copy;
}
module.exports = { allChecks, validEvidenceFile, validateEvidenceManifest, validateCountInventory, applyForeignKeyActions };
