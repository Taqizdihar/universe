const { analyzeBundle } = require('./inventory');
const { applyForeignKeyActions, validEvidenceFile, validateEvidenceManifest, validateCountInventory } = require('./evidence');
const { generateDependencyPlan } = require('./rehearsal');
const { evaluatePostSlugs, planLegacyPostCompatibility } = require('./legacyExceptions');
const { classifyPlaceholderWorkspace, classifyMissingSettings, assessMediaPreservation } = require('./legacyPreservation');

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
    const legacy = input.legacyInventory;
    const decisions = input.legacyDecisions || [];
    const exceptionContext = { schemaCollation: input.targetSchema.tables.find(t => t.name === 'posts')?.collation,
        sourceSnapshotFingerprint: input.sourceSnapshotFingerprint, targetSnapshotFingerprint: input.targetSnapshotFingerprint,
        legacyTables: sourceTables };
    let legacyExceptions = null;
    if (!legacy || !Array.isArray(legacy.posts) || !legacy.source || !sourceTables.every(table => Array.isArray(legacy.source[table]) && legacy.source[table].length === input.sourceCounts?.counts?.[table]) ||
        !Array.isArray(legacy.source?.posts) || legacy.posts.length !== legacy.source.posts.length ||
        legacy.posts.some(row => !legacy.source.posts.some(sourceRow => String(sourceRow.id) === String(row.id) && String(sourceRow.tenant_id) === String(row.tenant_id))) ||
        !Array.isArray(legacy.mediaReferences) || (legacy.source?.media || []).some(row => !legacy.mediaReferences.some(ref => ref.referenceType === 'db_media_record' && String(ref.mediaId) === String(row.id) && String(ref.tenantId) === String(row.tenant_id))) ||
        legacy.placeholderTenantId == null) {
        blockers.push('legacy_exception_inventory_incomplete'); missingEvidence.push('legacy_exception_inventory');
    } else {
        const postSlugs = evaluatePostSlugs(legacy.posts, decisions, exceptionContext);
        const placeholder = classifyPlaceholderWorkspace(legacy.source, legacy.placeholderTenantId, decisions.find(d => d.findingType === 'placeholder_workspace'), exceptionContext);
        const settings = classifyMissingSettings(legacy.source, legacy.placeholderTenantId, decisions.find(d => d.findingType === 'missing_optional_settings'), exceptionContext);
        const media = assessMediaPreservation(legacy.mediaReferences, decisions, exceptionContext);
        for (const finding of postSlugs) {
            if (!finding.approved) blockers.push('unapproved_legacy_post_slug_exception');
            if (finding.apiDetailReviewRequired) {
                const observation = (input.legacyApiObservations || []).find(item => JSON.stringify(item.sourceIds?.map(String).sort()) === JSON.stringify(finding.sourceIds));
                const compatibility = planLegacyPostCompatibility(finding, observation, decisions.find(d => d.findingType === 'legacy_api_ambiguity' && JSON.stringify(d.sourceIds?.map(String).sort()) === JSON.stringify(finding.sourceIds)), exceptionContext);
                if (compatibility.status !== 'reviewed_for_rehearsal') reviews.push({ object: `posts:${finding.sourceIds.join(',')}`, code: 'legacy_detail_selection_ambiguous' });
            }
        }
        if (placeholder.exclusionBlocked) blockers.push('placeholder_exclusion_not_verified');
        if (settings.status === 'absence_needs_review') reviews.push({ object: 'settings', code: 'missing_optional_settings_needs_review' });
        if (media.some(item => item.status === 'needs_availability_and_ownership_review')) reviews.push({ object: 'media', code: 'asset_ownership_or_availability_unverified' });
        legacyExceptions = { postSlugs, placeholder, settings, media };
    }
    const status = blockers.length || missingEvidence.length ? 'no_go' : reviews.length ? 'requires_review' : 'ready_for_rehearsal';
    return {
        status, schema, blockers: [...new Set(blockers)].sort(), reviews,
        missingEvidence: [...new Set(missingEvidence)].sort(),
        dependencyOrder: generateDependencyPlan(sourceTables),
        identityConflictSummary: { status: evidence.ready && mapping?.administratorReviewStatus === 'approved' ? 'evidence_reviewed' : 'not_assessed', rawIdentitiesIncluded: false },
        assetReadiness: { status: evidence.ready && mapping?.administratorReviewStatus === 'approved' ? 'evidence_reviewed' : 'not_assessed', urlsRewritten: false },
        collationRisk: { schemaDifferences: schema.findings.filter(f => f.code === 'column_collation_difference').length, sourceCollisionEvidence: evidence.missing.includes('source_collation_collisions') ? 'missing' : 'submitted', crossEnvironmentEvidence: evidence.missing.includes('cross_environment_collisions') ? 'missing' : 'submitted' },
        recordCounts: { source: input.sourceCounts?.counts || null, target: input.targetCounts?.counts || null }, legacyExceptions
    };
}
module.exports = { buildOfflineReport };
