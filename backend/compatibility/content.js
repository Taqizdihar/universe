// Pure, non-destructive bridge for the JSON documents stored by Pages and Posts.
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const plain = value => value !== null && typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function isJsonValue(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!plain(value) || seen.has(value)) return false;
    seen.add(value);
    const valid = Object.getOwnPropertySymbols(value).length === 0 && (Array.isArray(value)
        ? value.every((item, index) => Object.hasOwn(value, index) && isJsonValue(item, seen))
        : Object.entries(value).every(([key, item]) => !forbiddenKeys.has(key) && isJsonValue(item, seen)));
    seen.delete(value);
    return valid;
}
const cloneJson = value => JSON.parse(JSON.stringify(value));

function hasDuplicateKeys(text) {
    const stack = [];
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
            const start = i++;
            for (; i < text.length; i++) {
                if (text[i] === '\\') { i++; continue; }
                if (text[i] === '"') break;
            }
            const frame = stack.at(-1);
            if (frame?.type === 'object' && frame.expectKey) {
                let next = i + 1;
                while (/\s/.test(text[next] || '')) next++;
                if (text[next] === ':') {
                    const key = JSON.parse(text.slice(start, i + 1));
                    if (frame.keys.has(key)) return true;
                    frame.keys.add(key);
                    frame.expectKey = false;
                }
            }
        } else if (char === '{') stack.push({ type: 'object', keys: new Set(), expectKey: true });
        else if (char === '[') stack.push({ type: 'array' });
        else if (char === '}' || char === ']') stack.pop();
        else if (char === ',' && stack.at(-1)?.type === 'object') stack.at(-1).expectKey = true;
    }
    return false;
}

function parseLegacyContent(rawContent) {
    if (rawContent == null) return { format: 'empty', value: rawContent, original: rawContent, readOnly: false };
    if (typeof rawContent === 'string') {
        try {
            const value = JSON.parse(rawContent);
            if (hasDuplicateKeys(rawContent)) return { format: 'ambiguous-json-text', value: rawContent, original: rawContent, readOnly: true, reason: 'Duplicate JSON keys require manual review.' };
            if (!isJsonValue(value)) throw Error('Unsupported JSON value');
            return { format: Array.isArray(value) ? 'json-array-text' : 'json-object-text', value, original: rawContent, readOnly: false };
        } catch (_) {
            const format = /^\s*</.test(rawContent) ? 'html-text' : 'unparsed-text';
            return { format, value: rawContent, original: rawContent, readOnly: true, reason: 'Content cannot be safely patched as a JSON document.' };
        }
    }
    if (isJsonValue(rawContent)) return { format: Array.isArray(rawContent) ? 'array' : 'object', value: cloneJson(rawContent), original: cloneJson(rawContent), readOnly: false };
    return { format: 'unsupported', value: null, original: rawContent, readOnly: true, reason: 'Non-JSON content requires manual review.' };
}

function toEditorModel(rawContent, context = {}) {
    const parsed = parseLegacyContent(rawContent);
    return {
        ...parsed,
        kind: context.kind || 'unknown',
        blocks: Array.isArray(parsed.value) ? cloneJson(parsed.value) : null,
        document: !parsed.readOnly && parsed.value != null ? cloneJson(parsed.value) : parsed.value
    };
}

function applyEditorChanges(originalLegacyContent, changes, context = {}) {
    const model = toEditorModel(originalLegacyContent, context);
    if (model.readOnly) return { ...model, changed: false };
    if (!Array.isArray(changes)) throw TypeError('Changes must be an array of field patches.');
    if (changes.length === 0) return { ...model, changed: false };
    if (!plain(model.value)) return { ...model, readOnly: true, changed: false, reason: 'Empty or scalar content requires manual review.' };
    const updated = cloneJson(model.value);
    for (const change of changes) {
        if (!change || !Array.isArray(change.path) || change.path.length === 0 || !change.path.every(segment => typeof segment === 'string' || Number.isSafeInteger(segment)) || !isJsonValue(change.value)) throw TypeError('Invalid patch.');
        let target = updated;
        for (const segment of change.path.slice(0, -1)) {
            if (forbiddenKeys.has(String(segment)) || !Object.hasOwn(target, segment) || !plain(target[segment])) throw TypeError('Patch path is not a JSON container.');
            target = target[segment];
        }
        const leaf = change.path.at(-1);
        if (forbiddenKeys.has(String(leaf)) || (Array.isArray(target) && (!Number.isInteger(leaf) || leaf < 0 || leaf >= target.length))) throw TypeError('Unsafe patch path.');
        target[leaf] = cloneJson(change.value);
    }
    return { ...model, value: updated, blocks: Array.isArray(updated) ? cloneJson(updated) : null, document: cloneJson(updated), changed: true };
}

function toLegacyContent(model) {
    if (!model || typeof model !== 'object') throw TypeError('Invalid editor model.');
    if (model.readOnly || !model.changed) return model.original;
    if (!isJsonValue(model.value)) throw TypeError('Content is not JSON-compatible.');
    return model.format.endsWith('-text') ? JSON.stringify(model.value) : cloneJson(model.value);
}

function validateLegacyRoundTrip(originalContent, serializedContent) {
    const before = parseLegacyContent(originalContent);
    const after = parseLegacyContent(serializedContent);
    if (before.readOnly || after.readOnly) return { safe: Object.is(originalContent, serializedContent), reason: 'Opaque content must remain unchanged.' };
    const { isDeepStrictEqual } = require('node:util');
    return { safe: isDeepStrictEqual(before.value, after.value), reason: 'Semantic comparison of legacy JSON content.' };
}
module.exports = { parseLegacyContent, toEditorModel, applyEditorChanges, toLegacyContent, validateLegacyRoundTrip };
