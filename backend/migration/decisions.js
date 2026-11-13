const fs = require('node:fs');
const { validEvidenceFile } = require('./fileEvidence');

const kinds = Object.freeze({
    cross_template_published: { entity: 'posts', actions: ['preserve_all_with_api_review'] },
    mixed_publication_slug: { entity: 'posts', actions: ['preserve_all'] },
    draft_only_slug: { entity: 'posts', actions: ['preserve_all'] },
    verified_existing_identity: { entity: 'users', actions: ['map_to_existing_without_credential_change'] },
    placeholder_workspace: { entity: 'tenants', actions: ['preserve', 'exclude_after_dependency_review'] },
    missing_optional_settings: { entity: 'settings', actions: ['preserve_absence'] },
    media_reference: { entity: 'media', actions: ['preserve_reference', 'defer_migration'] },
    legacy_api_ambiguity: { entity: 'posts', actions: ['observe_and_review'] }
});
const id = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : null;
const ids = values => Array.isArray(values) ? values.map(id).sort() : null;
const fields = ['decisionId', 'sourceEntity', 'sourceIds', 'workspaceId', 'findingType', 'action', 'matchMode', 'targetId', 'sourceFingerprint', 'targetFingerprint', 'schemaCollation', 'sourceSnapshotFingerprint', 'targetSnapshotFingerprint'];
const payload = decision => Object.fromEntries(fields.map(field => [field, field === 'sourceIds' ? ids(decision[field]) : ['workspaceId', 'targetId'].includes(field) ? (decision[field] == null ? null : id(decision[field])) : decision[field] ?? null]));

function verifyDecision(decision, expected = {}) {
    if (!decision || !id(decision.decisionId) || !kinds[decision.findingType] || decision.sourceEntity !== kinds[decision.findingType].entity || !kinds[decision.findingType].actions.includes(decision.action) || !id(decision.workspaceId) || !ids(decision.sourceIds)?.length || ids(decision.sourceIds).includes(null) || new Set(ids(decision.sourceIds)).size !== decision.sourceIds.length || (decision.targetId != null && !id(decision.targetId)) || decision.administratorReviewStatus !== 'approved' || !decision.reviewedAt || !Number.isFinite(Date.parse(decision.reviewedAt)) || !decision.sourceSnapshotFingerprint || !decision.targetSnapshotFingerprint || !decision.schemaCollation) return false;
    if (!validEvidenceFile(decision.evidenceFile, decision.evidenceSha256, decision.decisionId)) return false;
    const actual = payload(decision);
    for (const [key, value] of Object.entries(expected)) if (JSON.stringify(actual[key]) !== JSON.stringify(key === 'sourceIds' ? ids(value) : value)) return false;
    try {
        const document = JSON.parse(fs.readFileSync(decision.evidenceFile, 'utf8'));
        const recorded = document.decisions?.find(item => item.decisionId === decision.decisionId);
        return recorded != null && JSON.stringify(payload(recorded)) === JSON.stringify(actual);
    } catch { return false; }
}
module.exports = { kinds, verifyDecision };
