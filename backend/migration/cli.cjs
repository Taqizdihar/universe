#!/usr/bin/env node
// Local files only: no database client, network API, or migration executor.
const path = require('node:path');
const fs = require('node:fs');
const { loadJson } = require('./inventory');
const { buildOfflineReport } = require('./offlineReport');

const root = path.resolve(__dirname, '../../database/schema-evidence/foundation-4');
const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--') && arg.includes('=')).map(arg => {
    const split = arg.indexOf('='); return [arg.slice(2, split), arg.slice(split + 1)];
}));
if (process.argv.includes('--help')) {
    process.stdout.write('node backend/migration/cli.cjs [--source=FILE --target=FILE --reference=FILE --source-fk-actions=FILE --source-counts=FILE --target-counts=FILE --evidence=FILE --mapping-evidence=FILE --resolutions=FILE --out=FILE]\nAll files are local JSON. No SQL is executed.\n');
    process.exit(0);
}
const file = (name, fallback) => path.resolve(args[name] || path.join(root, fallback));
const optional = name => args[name] ? loadJson(path.resolve(args[name])) : undefined;
try {
    const sourceFile = file('source', 'aiven-source-schema.json');
    const targetFile = file('target', 'kroombox-target-schema.json');
    const report = buildOfflineReport({
        sourceSchema: loadJson(sourceFile), targetSchema: loadJson(targetFile),
        reference: loadJson(file('reference', 'UNI-VERSE_schema_comparison.json')),
        sourceFile: path.basename(sourceFile), targetFile: path.basename(targetFile),
        sourceFkActions: optional('source-fk-actions'), sourceCounts: optional('source-counts'), targetCounts: optional('target-counts'),
        evidence: optional('evidence'), mappingEvidence: optional('mapping-evidence'), resolutions: optional('resolutions')
    });
    if (args.out) fs.writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(`${report.status}: ${report.schema.summary}\nMissing evidence: ${report.missingEvidence.length}; unresolved reviews: ${report.reviews.length}; blockers: ${report.blockers.join(', ') || 'none'}\n`);
    if (!args.out) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} catch (error) {
    process.stderr.write(`Offline inventory failed: ${error.message}\n`);
    process.exitCode = 1;
}
