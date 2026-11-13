const { verifyDecision } = require('./decisions');
const fs = require('node:fs');

function completePlaceholderAudit(decision, tenantId, context) {
    if (!decision?.evidenceFile || !Array.isArray(context.legacyTables)) return false;
    try {
        const audit = JSON.parse(fs.readFileSync(decision.evidenceFile, 'utf8')).placeholderDependencyAudit;
        return audit?.tenantId === String(tenantId) && audit.sourceSnapshotFingerprint === context.sourceSnapshotFingerprint &&
            audit.externalIntegrationsReviewed === true && audit.externalIntegrations === 0 && audit.apiConsumers === 0 &&
            JSON.stringify([...audit.coveredEntities].sort()) === JSON.stringify([...context.legacyTables].sort());
    } catch { return false; }
}

function classifyPlaceholderWorkspace(source, tenantId, decision, context = {}) {
    const key = String(tenantId);
    const tenant = (source.tenants || []).find(row => String(row.id) === key);
    if (!tenant) throw TypeError('Placeholder tenant is absent from the source inventory.');
    const dependencies = Object.fromEntries(Object.entries(source).filter(([entity]) => entity !== 'tenants').map(([entity, rows]) => [entity, rows.filter(row => String(row.tenant_id) === key).length]));
    const hasSettings = (source.settings || []).some(row => String(row.tenant_id) === key);
    const approvedExclusion = decision && verifyDecision(decision, { sourceEntity: 'tenants', sourceIds: [key], workspaceId: key,
        findingType: 'placeholder_workspace', action: 'exclude_after_dependency_review',
        schemaCollation: context.schemaCollation, sourceSnapshotFingerprint: context.sourceSnapshotFingerprint,
        targetSnapshotFingerprint: context.targetSnapshotFingerprint });
    const completeInventory = Array.isArray(context.legacyTables) && context.legacyTables.length === 19 && context.legacyTables.every(entity => Array.isArray(source[entity]));
    const canExclude = !!approvedExclusion && completeInventory && completePlaceholderAudit(decision, key, context) && Object.values(dependencies).every(count => count === 0);
    return { tenantId: key, classification: 'legacy_placeholder_candidate', policy: canExclude ? 'exclude_after_review' : 'preserve',
        hasSettings, createSettings: false, dependencies, dependencyInventoryComplete: completeInventory, exclusionBlocked: !!decision && !canExclude };
}

function classifyMissingSettings(source, tenantId, decision, context = {}) {
    const key = String(tenantId);
    if (!(source.tenants || []).some(row => String(row.id) === key)) throw TypeError('Tenant is absent from source inventory.');
    const exists = (source.settings || []).some(row => String(row.tenant_id) === key);
    const approved = !exists && !!decision && verifyDecision(decision, { sourceEntity: 'settings', sourceIds: [key], workspaceId: key,
        findingType: 'missing_optional_settings', action: 'preserve_absence', schemaCollation: context.schemaCollation,
        sourceSnapshotFingerprint: context.sourceSnapshotFingerprint, targetSnapshotFingerprint: context.targetSnapshotFingerprint });
    return { tenantId: key, status: exists ? 'present' : approved ? 'verified_absence' : 'absence_needs_review', createSettings: false };
}

function assessMediaPreservation(entries, decisions = [], context = {}) {
    if (!Array.isArray(entries)) throw TypeError('Sanitized media inventory is required.');
    const findings = [];
    const validId = value => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) || (typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value));
    for (const entry of entries) {
        if (!validId(entry.mediaId) || !validId(entry.tenantId) || !['db_media_record', 'nested_external_url', 'nested_internal_url', 'cta_or_navigation_url'].includes(entry.referenceType) || (entry.providerClass != null && !['google_drive', 'cloudinary', 'kroombox_cdn', 'other_external', 'external', 'relative', 'unknown'].includes(entry.providerClass))) throw TypeError('Invalid media reference classification.');
        const decision = decisions.find(item => item.findingType === 'media_reference' && Array.isArray(item.sourceIds) && item.sourceIds.map(String).includes(String(entry.mediaId)));
        const approved = !!decision && verifyDecision(decision, { sourceEntity: 'media', sourceIds: [String(entry.mediaId)], workspaceId: String(entry.tenantId),
            findingType: 'media_reference', action: 'preserve_reference', schemaCollation: context.schemaCollation, sourceSnapshotFingerprint: context.sourceSnapshotFingerprint,
            targetSnapshotFingerprint: context.targetSnapshotFingerprint });
        const isMedia = entry.referenceType !== 'cta_or_navigation_url';
        findings.push({ mediaId: String(entry.mediaId), tenantId: String(entry.tenantId), referenceType: entry.referenceType,
            providerClass: entry.providerClass || 'unknown', available: entry.availability === 'verified_available',
            status: !isMedia ? 'not_media' : approved && entry.availability === 'verified_available' ? 'reviewed_preserve_reference' : 'needs_availability_and_ownership_review',
            urlRewritten: false, uploaded: false });
    }
    return findings.sort((a, b) => `${a.tenantId}:${a.mediaId}`.localeCompare(`${b.tenantId}:${b.mediaId}`));
}
module.exports = { classifyPlaceholderWorkspace, classifyMissingSettings, assessMediaPreservation };
