#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { auditStructureExport, auditLiveChecksCsv } = require('./rehearsalSchemaAudit');

const sourceArg = process.argv.find(arg => arg.startsWith('--source='));
const liveChecksArg = process.argv.find(arg => arg.startsWith('--live-check-csv='));
if (!sourceArg || process.argv.includes('--help')) {
    process.stdout.write('node backend/migration/rehearsalSchemaAudit.cjs --source=/absolute/path/to/local-export.sql [--live-check-csv=/absolute/path/to/checks.csv]\nRead-only local analysis; does not execute or print SQL.\n');
    process.exitCode = sourceArg ? 0 : 2;
} else {
    try {
        const source = path.resolve(sourceArg.slice('--source='.length));
        const reference = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../database/schema-evidence/foundation-4/kroombox-target-schema.json'), 'utf8'));
        const report = auditStructureExport(fs.readFileSync(source, 'utf8'), reference);
        if (liveChecksArg) report.liveCheckEvidence = auditLiveChecksCsv(fs.readFileSync(path.resolve(liveChecksArg.slice('--live-check-csv='.length)), 'utf8'));
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } catch (error) {
        process.stderr.write(`Local structure audit failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}
