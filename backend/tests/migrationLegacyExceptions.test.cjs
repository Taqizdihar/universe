const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { evaluatePostSlugs, planLegacyPostCompatibility } = require('../migration/legacyExceptions');
const { classifyPlaceholderWorkspace, classifyMissingSettings, assessMediaPreservation } = require('../migration/legacyPreservation');
const { planMigration } = require('../migration/planner');
const { entities } = require('../migration/planner');
const { verifyDecision } = require('../migration/decisions');
const contract = require('../compatibility/contracts/legacy-api-v1.json');

const context = { schemaCollation: 'utf8mb4_unicode_ci', sourceSnapshotFingerprint: 'synthetic-source-snapshot', targetSnapshotFingerprint: 'synthetic-target-snapshot' };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'universe-exceptions-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
function approved(base) {
  const decision = { reviewedAt: '2026-11-13T00:00:00Z', administratorReviewStatus: 'approved', ...context, ...base };
  const evidenceFile = path.join(dir, `${decision.decisionId}.json`);
  const legacyTables = Object.keys(entities).filter(name => !['user_global_roles', 'super_admin_verifications'].includes(name));
  fs.writeFileSync(evidenceFile, JSON.stringify({ checks: [{ checkId: decision.decisionId, conclusion: 'passed', observations: ['synthetic independent review'] }], decisions: [decision],
    placeholderDependencyAudit: decision.findingType === 'placeholder_workspace' ? { tenantId: String(decision.workspaceId), sourceSnapshotFingerprint: context.sourceSnapshotFingerprint, externalIntegrationsReviewed: true, externalIntegrations: 0, apiConsumers: 0, coveredEntities: legacyTables } : undefined }));
  return { ...decision, evidenceFile, evidenceSha256: crypto.createHash('sha256').update(fs.readFileSync(evidenceFile)).digest('hex') };
}
const post = (id, tenant, slug, template, status, key) => ({ id, tenant_id: tenant, slug, template_type: template, status, targetCollationKey: key ? crypto.createHash('sha256').update(key).digest('hex') : null });

test('eight published cross-template pairs and three published/draft groups are distinct', () => {
  const posts = [];
  for (let i = 0; i < 8; i++) posts.push(post(i * 2 + 1, 51, `story-${i}`, 'Artikel', 'published', `key-${i}`), post(i * 2 + 2, 51, `story-${i}`, 'Event', 'published', `key-${i}`));
  for (let i = 0; i < 3; i++) posts.push(post(17 + i * 2, 51, `draft-${i}`, 'Artikel', 'published', `draft-key-${i}`), post(18 + i * 2, 51, `draft-${i}`, 'Artikel', 'draft', `draft-key-${i}`));
  const initial = evaluatePostSlugs(posts, [], context);
  assert.equal(initial.filter(f => f.type === 'cross_template_published').length, 8);
  assert.equal(initial.filter(f => f.type === 'mixed_publication_slug').length, 3);
  assert.equal(initial.filter(f => f.type === 'same_template_published').length, 0);
  assert.ok(initial.every(f => f.status === 'blocked'));
  const decisions = initial.map((f, i) => approved({ decisionId: `synthetic-slug-${i}`, sourceEntity: 'posts', sourceIds: f.sourceIds, workspaceId: f.tenantId,
    findingType: f.type, matchMode: f.match, action: f.type === 'cross_template_published' ? 'preserve_all_with_api_review' : 'preserve_all' }));
  const reviewed = evaluatePostSlugs(posts, decisions, context);
  assert.ok(reviewed.every(f => f.status === 'accepted_for_preservation'));
  assert.equal(reviewed.filter(f => f.apiDetailReviewRequired).length, 8);
  assert.deepEqual(reviewed, evaluatePostSlugs(posts, decisions, context));
  const stale = { ...context, sourceSnapshotFingerprint: 'later-snapshot' };
  assert.ok(evaluatePostSlugs(posts, decisions, stale).every(f => !f.approved));
  assert.equal(evaluatePostSlugs(posts, [{ ...decisions[0], workspaceId: '52' }, ...decisions.slice(1)], context)[0].approved, false);
});
test('same-template published collisions stay blocked; exact and target-collation matches differ', () => {
  const rows = [post(1, 7, 'News', 'Artikel', 'published', 'same'), post(2, 7, 'news', 'Artikel', 'published', 'same')];
  const finding = evaluatePostSlugs(rows, [], context)[0];
  assert.equal(finding.type, 'same_template_published');
  assert.equal(finding.match, 'target_collation');
  assert.equal(finding.approved, false);
  const forged = approved({ decisionId: 'synthetic-forged-same-template', sourceEntity: 'posts', sourceIds: ['1', '2'], workspaceId: '7', findingType: 'same_template_published', action: 'preserve_all', matchMode: 'target_collation' });
  assert.equal(evaluatePostSlugs(rows, [forged], context)[0].approved, false);
  rows[1].slug = 'News';
  assert.equal(evaluatePostSlugs(rows, [], context)[0].match, 'exact');
  rows[1].targetCollationKey = null;
  rows[1].slug = 'news';
  assert.equal(evaluatePostSlugs(rows, [], context)[0].match, 'provisional_normalized');
});
test('published cross-template API detail needs observed selection and separate review', () => {
  const rows = [post(1, 7, 'same', 'Artikel', 'published', 'k'), post(2, 7, 'same', 'Event', 'published', 'k')];
  const finding = evaluatePostSlugs(rows, [], context)[0];
  assert.equal(planLegacyPostCompatibility(finding).status, 'requires_review');
  const endpoint = contract.endpoints.find(e => e.id === 'posts.detail');
  assert.equal(endpoint.path, '/api/v1/public/posts/:slug');
  assert.equal(finding.apiDetailReviewRequired, true);
  const preservation = approved({ decisionId: 'synthetic-pair', sourceEntity: 'posts', sourceIds: ['1', '2'], workspaceId: '7', findingType: 'cross_template_published', matchMode: finding.match, action: 'preserve_all_with_api_review' });
  const reviewedFinding = evaluatePostSlugs(rows, [preservation], context)[0];
  const ambiguity = approved({ decisionId: 'synthetic-detail', sourceEntity: 'posts', sourceIds: ['1', '2'], workspaceId: '7', findingType: 'legacy_api_ambiguity', matchMode: finding.match, action: 'observe_and_review' });
  const observation = { listContainsBoth: true, listRecordIds: ['1', '2'], templateUsageReviewedIds: ['1', '2'], detailObservedSourceId: '1', detailObservedRehearsalMappedSourceId: '1', policy: 'preserve_observed_detail' };
  assert.equal(planLegacyPostCompatibility(reviewedFinding, observation, ambiguity, context).status, 'reviewed_for_rehearsal');
  assert.equal(planLegacyPostCompatibility(reviewedFinding, { ...observation, detailObservedRehearsalMappedSourceId: '2' }, ambiguity, context).status, 'requires_review');
});
test('verified existing identity permits only reviewed protected mapping and preserves target credentials', () => {
  const source = { users: [{ id: 1, emailFingerprint: 'synthetic-source' }], tenants: [{ id: 1, subdomain: 'placeholder' }], tenant_users: [{ id: 7, tenant_id: 1, user_id: 1, role: 'super_admin', status: 'active' }] };
  const target = { users: [{ id: 99, emailFingerprint: 'synthetic-target', credentialMarker: 'unchanged' }], user_global_roles: [{ user_id: 99, role: 'super_admin' }] };
  const mappings = [{ entity: 'users', sourceId: 1, targetId: 99, sourceTenantId: 1, mode: 'verified_existing', credentialPolicy: 'preserve_target', globalRolePolicy: 'no_import' }, { entity: 'tenants', sourceId: 1, targetId: 101 }, { entity: 'tenant_users', sourceId: 7, targetId: 102, sourceUserId: 1, sourceTenantId: 1, targetTenantId: 101 }];
  const input = { batchId: 'synthetic-batch', sourceSystem: 'aiven_v2', targetEnvironment: 'kroombox_staging', source, target, mappings, validationResults: [{ status: 'passed' }], decisionContext: context };
  assert.ok(planMigration(input).conflicts.some(c => c.type === 'protected_super_admin'));
  const decision = approved({ decisionId: 'synthetic-identity', sourceEntity: 'users', sourceIds: ['1'], workspaceId: '1', targetId: '99', sourceFingerprint: 'synthetic-source', targetFingerprint: 'synthetic-target', findingType: 'verified_existing_identity', action: 'map_to_existing_without_credential_change' });
  const reviewed = planMigration({ ...input, identityEquivalences: [decision] });
  assert.equal(reviewed.conflicts.some(c => c.type === 'protected_super_admin'), false);
  assert.deepEqual(reviewed.verifiedExistingIdentities, ['1']);
  assert.equal(target.users[0].credentialMarker, 'unchanged');
  assert.ok(planMigration({ ...input, identityEquivalences: [{ ...decision, evidenceSha256: '0'.repeat(64) }] }).conflicts.some(c => c.type === 'protected_super_admin'));
  assert.ok(planMigration({ ...input, mappings: [{ ...mappings[0], targetId: 88 }, ...mappings.slice(1)], identityEquivalences: [decision] }).conflicts.length > 0);
  assert.ok(planMigration({ ...input, mappings: [mappings[0], mappings[1], { ...mappings[2], targetTenantId: 202 }], identityEquivalences: [decision] }).conflicts.some(c => c.type === 'cross_tenant_mapping'));
});
test('placeholder is preserved with membership and missing Settings never creates a row', () => {
  const source = { tenants: [{ id: 1 }], tenant_users: [{ id: 2, tenant_id: 1, user_id: 1, status: 'active' }], settings: [], pages: [], posts: [], media: [], api_keys: [], comments: [], activity_logs: [] };
  const result = classifyPlaceholderWorkspace(source, 1);
  assert.equal(result.policy, 'preserve');
  assert.equal(result.hasSettings, false);
  assert.equal(result.createSettings, false);
  assert.equal(classifyMissingSettings(source, 1).status, 'absence_needs_review');
  const missingSettings = approved({ decisionId: 'synthetic-settings', sourceEntity: 'settings', sourceIds: ['1'], workspaceId: '1', findingType: 'missing_optional_settings', action: 'preserve_absence' });
  assert.equal(classifyMissingSettings(source, 1, missingSettings, context).status, 'verified_absence');
  const decision = approved({ decisionId: 'synthetic-placeholder', sourceEntity: 'tenants', sourceIds: ['1'], workspaceId: '1', findingType: 'placeholder_workspace', action: 'exclude_after_dependency_review' });
  assert.equal(classifyPlaceholderWorkspace(source, 1, decision, context).exclusionBlocked, true);
  assert.equal(classifyPlaceholderWorkspace({ ...source, tenant_users: [] }, 1, decision, context).policy, 'preserve');
  const legacyTables = Object.keys(entities).filter(name => !['user_global_roles', 'super_admin_verifications'].includes(name));
  assert.equal(legacyTables.length, 19);
  const complete = Object.fromEntries(legacyTables.map(name => [name, name === 'tenants' ? [{ id: 1 }] : []]));
  assert.equal(classifyPlaceholderWorkspace(complete, 1, decision, { ...context, legacyTables }).policy, 'exclude_after_review');
  const incompleteAudit = approved({ decisionId: 'synthetic-placeholder-no-audit', sourceEntity: 'tenants', sourceIds: ['1'], workspaceId: '1', findingType: 'placeholder_workspace', action: 'exclude_after_dependency_review' });
  const auditFile = JSON.parse(fs.readFileSync(incompleteAudit.evidenceFile, 'utf8'));
  delete auditFile.placeholderDependencyAudit;
  fs.writeFileSync(incompleteAudit.evidenceFile, JSON.stringify(auditFile));
  incompleteAudit.evidenceSha256 = crypto.createHash('sha256').update(fs.readFileSync(incompleteAudit.evidenceFile)).digest('hex');
  assert.equal(classifyPlaceholderWorkspace(complete, 1, incompleteAudit, { ...context, legacyTables }).policy, 'preserve');
});
test('media and nested references remain unchanged, external availability requires review', () => {
  const refs = [{ mediaId: 3, tenantId: 51, referenceType: 'db_media_record', providerClass: 'cloudinary', availability: 'unknown', url: 'https://example.invalid/a' }, { mediaId: 4, tenantId: 51, referenceType: 'nested_external_url', providerClass: 'google_drive', availability: 'unknown' }, { mediaId: 5, tenantId: 51, referenceType: 'cta_or_navigation_url', providerClass: 'external' }];
  const before = structuredClone(refs);
  const findings = assessMediaPreservation(refs);
  assert.deepEqual(refs, before);
  assert.equal(findings[0].status, 'needs_availability_and_ownership_review');
  assert.equal(findings[1].status, 'needs_availability_and_ownership_review');
  assert.equal(findings[2].status, 'not_media');
  assert.ok(findings.every(f => f.urlRewritten === false && !JSON.stringify(f).includes('https://')));
  assert.throws(() => assessMediaPreservation([{ mediaId: 'https://private.example.invalid/file', tenantId: 51, referenceType: 'db_media_record' }]));
  assert.equal(verifyDecision({ decisionId: 'unapproved' }), false);
});
test('Foundation 5A modules and asset audit have no live database execution path', () => {
  for (const name of ['decisions.js', 'fileEvidence.js', 'legacyExceptions.js', 'legacyPreservation.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../migration', name), 'utf8');
    assert.doesNotMatch(source, /require\(['"](?:mysql2|axios|node:http|node:https)/);
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\s+(?:TABLE|FROM|INTO|\w+\s+SET)\b/i);
  }
  const sql = fs.readFileSync(path.join(__dirname, '../../database/audit/foundation-5a-legacy-assets.sql'), 'utf8');
  assert.match(sql, /`defaultdb`\.`media`/);
  const statements = sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');
  assert.doesNotMatch(statements, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\s+(?:TABLE|FROM|INTO|\w+\s+SET)\b/i);
});
