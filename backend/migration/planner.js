// Offline planning only. No DB imports, SQL executor, network calls, or writes.
const entities = Object.freeze({
    users: [], tenants: [], tenant_users: ['users', 'tenants'], user_global_roles: ['users'],
    api_keys: ['tenants'], media_folders: ['tenants'], media: ['tenants', 'media_folders', 'users'],
    post_categories: ['tenants'], settings: ['tenants'], layouts: ['tenants'],
    pages: ['tenants', 'users'], posts: ['tenants', 'users', 'post_categories', 'media'],
    comments: ['tenants', 'posts'], contact_inquiries: ['tenants'], notifications: ['tenants', 'users'],
    activity_logs: ['tenants', 'users'], plugins: ['tenants'], global_faqs: []
});
const origins = new Set(['aiven_v2', 'kroombox_native', 'manual_import']);
const modes = new Set(['legacy_compatible', 'hybrid', 'native_v2']);
const contracts = new Set(['legacy-api-v1', 'dynamic-api-v2']);
const transitions = Object.freeze({ planned: ['prepared', 'failed'], prepared: ['validated', 'failed'], validated: ['approved', 'failed'], approved: ['applied', 'failed'], applied: ['rolled_back', 'reconciled'], failed: ['prepared', 'reconciled'], rolled_back: ['reconciled'], reconciled: [] });
const id = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : null;
const sorted = entries => [...entries].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

function validateWorkspaceCompatibility(input) {
    if (!id(input?.tenantId) || !origins.has(input.originSystem || 'kroombox_native') || !modes.has(input.contentMode || 'legacy_compatible') || !contracts.has(input.apiContractVersion || 'legacy-api-v1')) throw TypeError('Invalid workspace compatibility metadata.');
    if (input.migrationBatchId != null && !id(input.migrationBatchId)) throw TypeError('Invalid migration batch ID.');
    if (input.verifiedAt != null && (typeof input.verifiedAt !== 'string' || !Number.isFinite(Date.parse(input.verifiedAt)))) throw TypeError('Invalid verification timestamp.');
    if (input.verifiedAt && !input.migrationBatchId) throw TypeError('Verified workspace requires a migration batch.');
    return { tenantId: id(input.tenantId), originSystem: input.originSystem || 'kroombox_native', contentMode: input.contentMode || 'legacy_compatible', apiContractVersion: input.apiContractVersion || 'legacy-api-v1', migrationBatchId: input.migrationBatchId || null, verifiedAt: input.verifiedAt || null };
}
function summarizeValidations(results) {
    const counts = { passed: 0, failed: 0, pending: 0, waived: 0 };
    for (const item of results || []) {
        if (!Object.hasOwn(counts, item.status)) throw TypeError('Invalid validation status.');
        counts[item.status]++;
    }
    return { counts, ready: counts.passed > 0 && counts.failed === 0 && counts.pending === 0 && counts.waived === 0 };
}
function transitionBatchStatus(batch, next, evidence = {}) {
    if (!transitions[batch?.status]?.includes(next)) throw TypeError('Invalid batch status transition.');
    if (next === 'validated' && !summarizeValidations(evidence.validationResults).ready) throw TypeError('All checks must pass before validation.');
    if (next === 'approved' && !evidence.approvalReference) throw TypeError('Explicit administrator approval is required.');
    if (next === 'applied' && !evidence.applicationReference) throw TypeError('Manual application evidence is required.');
    if (['rolled_back', 'reconciled'].includes(next) && !evidence.reconciliationReference) throw TypeError('Reconciliation evidence is required.');
    return { ...batch, status: next };
}
function dependencyOrder(selected = Object.keys(entities)) {
    const requested = new Set(selected), ordered = [], visiting = new Set(), visited = new Set();
    function visit(entity) {
        if (!Object.hasOwn(entities, entity)) throw TypeError('Unknown entity type.');
        if (visiting.has(entity)) throw Error('Dependency cycle.');
        if (visited.has(entity)) return;
        visiting.add(entity);
        for (const dependency of entities[entity]) if (requested.has(dependency)) visit(dependency);
        visiting.delete(entity); visited.add(entity); ordered.push(entity);
    }
    [...requested].sort().forEach(visit);
    return ordered;
}
function rejectSecrets(input) {
    const seen = new WeakSet();
    const visit = value => {
        if (!value || typeof value !== 'object') return;
        if (seen.has(value)) return;
        seen.add(value);
        for (const [key, child] of Object.entries(value)) {
            if (/^(api_key|password_hash|password|jwt|smtp_pass|reset_token|code_hash)$/i.test(key)) throw TypeError('Raw credentials and auth material are not accepted by the planner.');
            visit(child);
        }
    };
    visit(input);
}
function planMigration({ batchId, sourceSystem, targetEnvironment, source = {}, target = {}, mappings = [], validationResults = [] }) {
    if (!id(batchId) || !origins.has(sourceSystem) || !['kroombox_development', 'kroombox_staging', 'kroombox_production'].includes(targetEnvironment)) throw TypeError('Invalid batch identity.');
    rejectSecrets({ source, target, mappings });
    for (const [entity, rows] of Object.entries({ ...source, ...target })) {
        if (!Object.hasOwn(entities, entity) || !Array.isArray(rows)) throw TypeError('Unknown or invalid inventory.');
    }
    const conflicts = [], seenSource = new Set(), seenTarget = new Set();
    const add = (entity, sourceId, type) => conflicts.push({ entity, sourceId: String(sourceId), type });
    const sourceUsers = source.users || [], targetUsers = target.users || [];
    const sourceIds = new Map();
    for (const [entity, rows] of Object.entries(source)) {
        const ids = new Set();
        for (const row of rows) {
            const recordId = id(row.id);
            if (!recordId) throw TypeError('Invalid source record identity.');
            if (ids.has(recordId)) add(entity, recordId, 'duplicate_source_record');
            ids.add(recordId);
        }
        sourceIds.set(entity, ids);
    }
    const sourceEmails = new Set();
    const targetSuperAdmins = new Set((target.user_global_roles || []).filter(r => r.role === 'super_admin').map(r => id(r.user_id)));
    for (const sourceUser of sourceUsers) {
        const sid = id(sourceUser.id);
        const numeric = targetUsers.find(user => id(user.id) === sid && user.email !== sourceUser.email);
        if (numeric) add('users', sid, 'numeric_id_collision');
        if (targetUsers.some(user => user.email && sourceUser.email && user.email.toLowerCase() === sourceUser.email.toLowerCase())) add('users', sid, 'email_match_requires_review');
        if (sourceUser.email) {
            const email = sourceUser.email.toLowerCase();
            if (sourceEmails.has(email)) add('users', sid, 'duplicate_source_email');
            sourceEmails.add(email);
        }
    }
    for (const tenant of source.tenants || []) if ((target.tenants || []).some(t => t.subdomain?.toLowerCase() === tenant.subdomain?.toLowerCase())) add('tenants', id(tenant.id), 'subdomain_collision');
    for (const key of source.api_keys || []) if (key.fingerprint && (target.api_keys || []).some(k => k.fingerprint === key.fingerprint)) add('api_keys', id(key.id), 'api_key_collision');
    const tenantMapping = new Map(mappings.filter(m => m.entity === 'tenants').map(m => [id(m.sourceId), id(m.targetId)]));
    const userMapping = new Map(mappings.filter(m => m.entity === 'users').map(m => [id(m.sourceId), id(m.targetId)]));
    for (const mapping of mappings) {
        if (!Object.hasOwn(entities, mapping.entity) || !id(mapping.sourceId) || (mapping.targetId != null && !id(mapping.targetId))) throw TypeError('Invalid explicit mapping.');
        const sourceKey = `${mapping.entity}:${id(mapping.sourceId)}`;
        const targetKey = mapping.targetId == null ? null : `${mapping.entity}:${id(mapping.targetId)}`;
        if (seenSource.has(sourceKey)) add(mapping.entity, mapping.sourceId, 'duplicate_source_mapping');
        if (!sourceIds.get(mapping.entity)?.has(id(mapping.sourceId))) add(mapping.entity, mapping.sourceId, 'missing_source_record');
        if (targetKey && seenTarget.has(targetKey)) add(mapping.entity, mapping.sourceId, 'duplicate_target_mapping');
        seenSource.add(sourceKey); if (targetKey) seenTarget.add(targetKey);
        if (mapping.entity === 'users' && targetSuperAdmins.has(id(mapping.targetId))) add('users', mapping.sourceId, 'protected_super_admin');
        if ((target[mapping.entity] || []).some(row => id(row.id) === id(mapping.targetId)) && !(mapping.entity === 'users' && targetSuperAdmins.has(id(mapping.targetId)))) add(mapping.entity, mapping.sourceId, 'target_id_occupied_requires_review');
        if (mapping.entity === 'user_global_roles') add('user_global_roles', mapping.sourceId, 'global_role_requires_review');
        if (mapping.sourceTenantId != null && mapping.targetTenantId != null && tenantMapping.has(id(mapping.sourceTenantId)) && tenantMapping.get(id(mapping.sourceTenantId)) !== id(mapping.targetTenantId)) add(mapping.entity, mapping.sourceId, 'cross_tenant_mapping');
        if (mapping.sourceTenantId != null && !tenantMapping.has(id(mapping.sourceTenantId))) add(mapping.entity, mapping.sourceId, 'missing_tenant_mapping');
        if (mapping.entity === 'tenant_users' && !userMapping.has(id(mapping.sourceUserId))) add('tenant_users', mapping.sourceId, 'missing_user_mapping');
        if (mapping.entity === 'api_keys' && !tenantMapping.has(id(mapping.sourceTenantId))) add('api_keys', mapping.sourceId, 'missing_tenant_mapping');
        if (mapping.entity === 'api_keys' && mapping.targetId != null) {
            const targetKey = (target.api_keys || []).find(key => id(key.id) === id(mapping.targetId));
            if (targetKey && tenantMapping.get(id(mapping.sourceTenantId)) !== id(targetKey.tenant_id)) add('api_keys', mapping.sourceId, 'api_key_ownership_conflict');
        }
    }
    const sourceTenantIds = new Set((source.tenants || []).map(t => id(t.id)));
    const sourceUserIds = new Set(sourceUsers.map(u => id(u.id)));
    const referenceFields = { posts: [['category_id', 'post_categories'], ['featured_image_id', 'media'], ['author_id', 'users']], pages: [['author_id', 'users']], comments: [['post_id', 'posts']], media: [['folder_id', 'media_folders'], ['uploaded_by', 'users']], notifications: [['user_id', 'users']] };
    for (const [entity, rows] of Object.entries(source)) {
        for (const row of rows) {
            if (row.tenant_id != null && !sourceTenantIds.has(id(row.tenant_id))) add(entity, row.id ?? `${row.tenant_id}:${row.user_id}`, 'missing_tenant_reference');
            if (row.user_id != null && !sourceUserIds.has(id(row.user_id))) add(entity, row.id ?? `${row.tenant_id}:${row.user_id}`, 'missing_user_reference');
            for (const [field, relatedEntity] of referenceFields[entity] || []) {
                if (row[field] != null) {
                    const related = (source[relatedEntity] || []).find(candidate => id(candidate.id) === id(row[field]));
                    if (!related) add(entity, row.id, `missing_${relatedEntity}_reference`);
                    else if (row.tenant_id != null && related.tenant_id != null && id(row.tenant_id) !== id(related.tenant_id)) add(entity, row.id, `cross_tenant_${relatedEntity}_reference`);
                }
            }
            if (entity === 'user_global_roles') add(entity, row.id, 'global_role_requires_review');
        }
    }
    const validation = summarizeValidations(validationResults);
    const entitiesCount = Object.fromEntries(Object.keys(source).sort().map(entity => [entity, source[entity].length]));
    const report = { batchId, source: sourceSystem, target: targetEnvironment, status: 'needs_review', entities: entitiesCount, dependencyOrder: dependencyOrder(Object.keys(source)), conflicts: sorted(conflicts), validation };
    if (!conflicts.length && validation.ready && mappings.length > 0) report.status = 'ready_for_administrator_review';
    return report;
}
function planAssetMappings(entries) {
    const seen = new Set(), targets = new Set();
    return entries.map(entry => {
        if (!id(entry.sourceMediaId) || !['db_media_id', 'cdn_file_id', 'media_url', 'nested_json_reference'].includes(entry.sourceReferenceType)) throw TypeError('Invalid asset identity.');
        if (entry.targetMediaId != null && !id(entry.targetMediaId)) throw TypeError('Invalid target asset identity.');
        if (seen.has(id(entry.sourceMediaId))) throw TypeError('Duplicate source media identity.');
        if (entry.targetMediaId != null && targets.has(id(entry.targetMediaId))) throw TypeError('Duplicate target media identity.');
        seen.add(id(entry.sourceMediaId));
        if (entry.targetMediaId != null) targets.add(id(entry.targetMediaId));
        return { sourceMediaId: id(entry.sourceMediaId), targetMediaId: entry.targetMediaId == null ? null : id(entry.targetMediaId), sourceReferenceType: entry.sourceReferenceType, mappingStatus: 'proposed', verificationStatus: 'pending' };
    });
}
module.exports = { entities, validateWorkspaceCompatibility, summarizeValidations, transitionBatchStatus, dependencyOrder, planMigration, planAssetMappings };
