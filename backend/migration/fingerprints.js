const crypto = require('node:crypto');

function fingerprintIdentity(value, kind, key) {
    if (typeof value !== 'string' || !value || !['email', 'subdomain', 'api_key', 'slug'].includes(kind) || !Buffer.isBuffer(key) || key.length < 32) throw TypeError('Invalid protected fingerprint input.');
    const normalized = kind === 'api_key' ? value : value.trim().toLowerCase();
    return crypto.createHmac('sha256', key).update(kind).update('\0').update(normalized).digest('hex');
}
function compareFingerprintSets(source, target) {
    if (!Array.isArray(source) || !Array.isArray(target) || [...source, ...target].some(v => typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v))) throw TypeError('Only HMAC-SHA256 fingerprints are accepted.');
    const targetSet = new Set(target);
    return { sourceDuplicates: source.length - new Set(source).size, targetDuplicates: target.length - targetSet.size, crossEnvironmentMatches: [...new Set(source)].filter(value => targetSet.has(value)).length };
}
module.exports = { fingerprintIdentity, compareFingerprintSets };
