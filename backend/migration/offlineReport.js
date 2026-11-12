const { analyzeBundle } = require('./inventory');
const { applyForeignKeyActions, validEvidenceFile, validateEvidenceManifest, validateCountInventory } = require('./evidence');
const { generateDependencyPlan } = require('./rehearsal');

function buildOfflineReport(input) {
    const source = input.sourceFkActions ? applyForeignKeyActions(input.sourceSchema, input.sourceFkActions) : input.sourceSchema;
    const schema = analyzeBundle({ source, target: input.targetSchema, reference: input.reference, resolutions: input.resolutions || [], sourceFile: input.sourceFile, targetFile: input.targetFile });
    const sourceTables = source.tables.map(t => t.name);
    const targetTables = input.targetSchema.tables.map(t => t.name);
    const sourceCounts = validateCountInventory(input.sourceCounts, sourceTables, 'aiven_v2');
    const targetCounts = validateCountInventory(input.targetCounts, targetTables, 'kroombox_development');
    const evidence = validateEvidenceManifest(input.evidence || { results: [] });
    const missingEvidence = [...sourceCounts.missing.map(v => `source:${v}`), ...targetCounts.missing.map(v => `target:${v}`), ...evidence.missing.map(v => `check:${v}`), ...evidence.invalid.map(v => `invalid_check:${v}`)];
    const blockers = [];
    if (schema.referenceMismatches.length) blockers.push('schema_reference_mismatch');
    if (schema.counts.blocking) blockers.push('schema_blocking_findings');
    if (!sourceCounts.ready || !targetCounts.ready) blockers.push('record_inventories_incomplete');
    if (!evidence.ready) blockers.push('validation_evidence_incomplete');
    const mapping = input.mappingEvidence;
    if (!validEvidenceFile(mapping?.evidenceFile, mapping?.evidenceSha256, 'identity_mapping_decisions') || !mapping.collectedAt || !Number.isFinite(Date.parse(mapping.collectedAt)) || mapping.administratorReviewStatus !== 'approved' || sourceTables.some(table => !Number.isSafeInteger(mapping.mappedCounts?.[table]) || mapping.mappedCounts[table] !== input.sourceCounts?.counts?.[table])) {
        blockers.push('identity_mapping_evidence_incomplete'); missingEvidence.push('identity_mapping_decisions');
    }
    const reviews = schema.findings.filter(f => f.classification === 'requires_review' && !f.resolved).map(f => ({ object: f.object, code: f.code, evidence: f.evidence }));
    if (schema.counts.compatible_with_transformation && !evidence.ready) reviews.push({ object: 'collation', code: 'collision_and_ordering_evidence_required' });
    const status = blockers.length || missingEvidence.length ? 'no_go' : reviews.length ? 'requires_review' : 'ready_for_rehearsal';
    return {
        status, schema, blockers: [...new Set(blockers)].sort(), reviews,
        missingEvidence: [...new Set(missingEvidence)].sort(),
        dependencyOrder: generateDependencyPlan(sourceTables),
        identityConflictSummary: { status: evidence.ready && mapping?.administratorReviewStatus === 'approved' ? 'evidence_reviewed' : 'not_assessed', rawIdentitiesIncluded: false },
        assetReadiness: { status: evidence.ready && mapping?.administratorReviewStatus === 'approved' ? 'evidence_reviewed' : 'not_assessed', urlsRewritten: false },
        collationRisk: { schemaDifferences: schema.findings.filter(f => f.code === 'column_collation_difference').length, sourceCollisionEvidence: evidence.missing.includes('source_collation_collisions') ? 'missing' : 'submitted', crossEnvironmentEvidence: evidence.missing.includes('cross_environment_collisions') ? 'missing' : 'submitted' },
        recordCounts: { source: input.sourceCounts?.counts || null, target: input.targetCounts?.counts || null }
    };
}
module.exports = { buildOfflineReport };
