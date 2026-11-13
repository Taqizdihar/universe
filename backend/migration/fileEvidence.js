const fs = require('node:fs');
const crypto = require('node:crypto');

function validEvidenceFile(file, sha256, checkId) {
    if (typeof file !== 'string' || !file || !/^[a-f0-9]{64}$/i.test(sha256 || '') || !fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) return false;
    const bytes = fs.readFileSync(file);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== sha256.toLowerCase()) return false;
    try {
        const body = JSON.parse(bytes);
        return body.checks?.some(item => item.checkId === checkId && item.conclusion === 'passed' && Array.isArray(item.observations) && item.observations.length > 0) === true;
    } catch { return false; }
}
module.exports = { validEvidenceFile };
