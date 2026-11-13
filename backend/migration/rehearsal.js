const { entities, dependencyOrder, planMigration } = require('./planner');
const { compareSchemas } = require('./schemaMapping');
const { evaluatePostSlugs, planLegacyPostCompatibility } = require('./legacyExceptions');

const protectedTables = new Set(['super_admin_verifications', 'account_auth_state', 'password_reset_tokens']);
const platformTables = new Set(['global_faqs', 'plugins', 'update_history', 'update_images']);
const identityTables = new Set(['users', 'tenants', 'tenant_users', 'user_global_roles']);
const requiredChecks = Object.freeze(['identity_mapping', 'tenant_memberships', 'api_key_ownership', 'password_hash_compatibility', 'legacy_content_round_trip', 'published_status', 'legacy_api_v1', 'media_references', 'collation_collisions', 'backup_and_rollback']);
const value = item => String(item).trim().toLowerCase();

function generateDependencyPlan(legacyTables) {
    if (!Array.isArray(legacyTables) || new Set(legacyTables).size !== legacyTables.length || legacyTables.some(table => !Object.hasOwn(entities, table))) throw TypeError('Explicit, known legacy table inventory is required.');
    return dependencyOrder(legacyTables).map((table, index) => ({
        order: index + 1, table,
        group: protectedTables.has(table) ? 'authentication' : identityTables.has(table) ? 'identity' : platformTables.has(table) ? 'platform' : 'content_and_media',
        action: protectedTables.has(table) ? 'exclude_from_transfer' : table === 'user_global_roles' ? 'manual_role_review' : 'map_and_validate'
    }));
}

function assessRehearsal(input) {
    const { legacyTables, source = {}, target = {}, mappings = [], validationResults = [] } = input;
    const blockers = [], review = [];
    const add = (list, entity, recordId, code) => list.push({ entity, recordId: String(recordId), code });
    let schemaReport;
    try { schemaReport = compareSchemas(input.sourceSchema, input.targetSchema); }
    catch { schemaReport = { ready: false, findings: [] }; }
    if (!schemaReport.ready) add(blockers, 'schema', '-', 'schema_mapping_not_ready');
    if (!Array.isArray(legacyTables) || legacyTables.length !== 19) add(blockers, 'schema', '-', 'legacy_table_roster_unverified');
    if (Array.isArray(legacyTables) && (legacyTables.some(table => !(input.sourceSchema?.tables || []).some(t => t.name === table)) || (input.sourceSchema?.tables || []).length !== legacyTables.length)) add(blockers, 'schema', '-', 'schema_roster_mismatch');
    const steps = generateDependencyPlan(legacyTables || []);
    for (const table of legacyTables || []) if (!Array.isArray(source[table])) add(blockers, table, '-', 'missing_source_inventory');
    const plan = planMigration({ batchId: input.batchId, sourceSystem: input.sourceSystem, targetEnvironment: input.targetEnvironment, source, target, mappings, validationResults, identityEquivalences: input.identityEquivalences || [], decisionContext: input.slugContext || {} });
    for (const conflict of plan.conflicts) add(blockers, conflict.entity, conflict.sourceId, conflict.type);
    const mapped = new Set(mappings.map(m => `${m.entity}:${m.sourceId}`));
    for (const [entity, rows] of Object.entries(source)) {
        for (const row of rows) {
            if (!protectedTables.has(entity) && !mapped.has(`${entity}:${row.id}`)) add(blockers, entity, row.id, 'missing_identity_map');
            if (row.tenant_id == null && !identityTables.has(entity) && !platformTables.has(entity)) add(blockers, entity, row.id, 'orphaned_tenant_content');
            if (Number(row.nestedMediaReferenceCount || 0) > 0) add(review, entity, row.id, 'nested_media_reference_review');
        }
    }
    for (const entity of ['pages']) {
        const slugs = new Set();
        for (const row of source[entity] || []) {
            if (!row.slug) continue;
            const key = `${row.tenant_id}:${value(row.slug)}`;
            if (slugs.has(key)) add(blockers, entity, row.id, 'duplicate_tenant_slug');
            slugs.add(key);
        }
    }
    const postSlugFindings = evaluatePostSlugs(source.posts || [], input.decisions || [], input.slugContext || {});
    for (const finding of postSlugFindings) {
        if (!finding.approved) add(blockers, 'posts', finding.sourceIds.join(','), 'duplicate_tenant_slug');
        if (finding.apiDetailReviewRequired) {
            const observation = (input.legacyApiObservations || []).find(item => JSON.stringify(item.sourceIds?.map(String).sort()) === JSON.stringify(finding.sourceIds));
            const decision = (input.decisions || []).find(item => item.findingType === 'legacy_api_ambiguity' && JSON.stringify(item.sourceIds?.map(String).sort()) === JSON.stringify(finding.sourceIds));
            if (planLegacyPostCompatibility(finding, observation, decision, input.slugContext || {}).status !== 'reviewed_for_rehearsal') add(review, 'posts', finding.sourceIds.join(','), 'legacy_api_detail_ambiguity');
        }
    }
    for (const entity of ['users', 'tenants']) {
        const attr = entity === 'users' ? 'emailFingerprint' : 'subdomain';
        const seen = new Set();
        for (const row of source[entity] || []) {
            if (!row[attr]) { add(blockers, entity, row.id, `missing_${attr}_identity`); continue; }
            const key = value(row[attr]);
            if (seen.has(key)) add(blockers, entity, row.id, `duplicate_${attr}_identity`);
            seen.add(key);
        }
    }
    for (const row of source.api_keys || []) if (!row.fingerprint) add(blockers, 'api_keys', row.id, 'missing_api_key_fingerprint');
    for (const check of requiredChecks) if (!validationResults.some(item => item.checkId === check && item.status === 'passed')) add(blockers, 'validation', check, 'required_check_not_passed');
    if (!plan.validation.ready) add(blockers, 'validation', '-', 'validation_incomplete');
    for (const step of steps) if (step.action === 'manual_role_review' && (source[step.table] || []).length > 0) add(review, step.table, '-', step.action);
    const order = list => list.sort((a, b) => `${a.entity}:${a.recordId}:${a.code}`.localeCompare(`${b.entity}:${b.recordId}:${b.code}`));
    return {
        batchId: plan.batchId, status: blockers.length || review.length ? 'no_go' : 'ready_for_administrator_review',
        go: blockers.length === 0 && review.length === 0,
        blockers: order(blockers), review: order(review), steps,
        counts: plan.entities, validation: plan.validation, postSlugFindings, verifiedExistingIdentities: plan.verifiedExistingIdentities
    };
}

module.exports = { generateDependencyPlan, assessRehearsal, requiredChecks };
