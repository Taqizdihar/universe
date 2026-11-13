const { verifyDecision } = require('./decisions');

const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
const recordId = row => String(row.id);
const validKey = row => typeof row.targetCollationKey === 'string' && /^[a-f0-9]{64}$/.test(row.targetCollationKey);

function evaluatePostSlugs(posts, decisions = [], context = {}) {
    if (!Array.isArray(posts) || !Array.isArray(decisions)) throw TypeError('Post inventory and decisions are required.');
    const rows = posts.filter(row => row.slug != null);
    if (rows.some(row => !/^[A-Za-z0-9:_-]{1,128}$/.test(String(row.id)) || !/^[A-Za-z0-9:_-]{1,128}$/.test(String(row.tenant_id)))) throw TypeError('Invalid Post identity in slug inventory.');
    const parent = rows.map((_, index) => index);
    const find = index => parent[index] === index ? index : (parent[index] = find(parent[index]));
    const merge = (left, right) => { parent[find(right)] = find(left); };
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        if (String(a.tenant_id) !== String(b.tenant_id)) continue;
        if (a.slug === b.slug || (validKey(a) && validKey(b) && a.targetCollationKey === b.targetCollationKey) || ((!validKey(a) || !validKey(b)) && normalize(a.slug) === normalize(b.slug))) merge(i, j);
    }
    const groups = new Map();
    rows.forEach((row, index) => { const root = find(index); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(row); });
    const findings = [];
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        const tenantId = String(group[0].tenant_id);
        const sourceIds = group.map(recordId).sort();
        const published = group.filter(row => normalize(row.status) === 'published');
        const templates = published.map(row => normalize(row.template_type || 'unknown'));
        const sameTemplatePublished = new Set(templates).size !== templates.length;
        const type = sameTemplatePublished ? 'same_template_published' : published.length >= 2 ? 'cross_template_published' : published.length === 1 ? 'mixed_publication_slug' : 'draft_only_slug';
        const match = group.every(row => row.slug === group[0].slug) ? 'exact' : group.every(row => validKey(row) && row.targetCollationKey === group[0].targetCollationKey) ? 'target_collation' : 'provisional_normalized';
        const action = type === 'cross_template_published' ? 'preserve_all_with_api_review' : 'preserve_all';
        const decision = decisions.find(item => item.sourceEntity === 'posts' && item.findingType === type && Array.isArray(item.sourceIds) && JSON.stringify(item.sourceIds.map(String).sort()) === JSON.stringify(sourceIds));
        const approved = type !== 'same_template_published' && match !== 'provisional_normalized' && !!decision && verifyDecision(decision, {
            sourceEntity: 'posts', sourceIds, workspaceId: tenantId, findingType: type, action, matchMode: match,
            schemaCollation: context.schemaCollation, sourceSnapshotFingerprint: context.sourceSnapshotFingerprint,
            targetSnapshotFingerprint: context.targetSnapshotFingerprint
        });
        findings.push({ tenantId, sourceIds, type, match, approved, status: approved ? 'accepted_for_preservation' : 'blocked',
            apiDetailReviewRequired: type === 'cross_template_published', decisionId: approved ? decision.decisionId : null });
    }
    return findings.sort((a, b) => `${a.tenantId}:${a.sourceIds.join(',')}`.localeCompare(`${b.tenantId}:${b.sourceIds.join(',')}`));
}

function planLegacyPostCompatibility(finding, observation = {}, decision, context = {}) {
    if (finding?.type !== 'cross_template_published') return { status: 'not_applicable' };
    const covered = finding.approved && observation.listContainsBoth === true && finding.sourceIds.every(id => (observation.listRecordIds || []).map(String).includes(id)) &&
        finding.sourceIds.every(id => (observation.templateUsageReviewedIds || []).map(String).includes(id)) &&
        finding.sourceIds.includes(String(observation.detailObservedSourceId)) && finding.sourceIds.includes(String(observation.detailObservedRehearsalMappedSourceId));
    const decisionApproved = decision && verifyDecision(decision, { sourceEntity: 'posts', sourceIds: finding.sourceIds,
        workspaceId: finding.tenantId, findingType: 'legacy_api_ambiguity', action: 'observe_and_review', matchMode: finding.match,
        schemaCollation: context.schemaCollation, sourceSnapshotFingerprint: context.sourceSnapshotFingerprint,
        targetSnapshotFingerprint: context.targetSnapshotFingerprint });
    return { status: covered && decisionApproved && observation.detailObservedSourceId === observation.detailObservedRehearsalMappedSourceId && observation.policy === 'preserve_observed_detail' ? 'reviewed_for_rehearsal' : 'requires_review',
        legacyDetailSelectionIsNondeterministic: true, responseShapeChanged: false };
}

module.exports = { evaluatePostSlugs, planLegacyPostCompatibility };
