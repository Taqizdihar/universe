#!/usr/bin/env node
// Only private filesystem input/output. This CLI never starts the application.
const fs = require('node:fs');
const path = require('node:path');
const { loadSnapshot, privateDirectory, readPrivate, prepare } = require('./snapshotPackage');
const { writePackage, syntheticBootstrap } = require('./packageSql');
async function main() {
    const argv = process.argv.slice(2), allowed = ['input', 'output', 'config', 'review', 'key', 'batch-size'];
    if (argv.includes('--help')) { console.log('Offline only: node backend/migration/package.cjs --input=/ABS/PRIVATE --output=/ABS/EMPTY --key=/ABS/PRIVATE/key [--config=/ABS/PRIVATE/config.json --review=/ABS/PRIVATE/review.json --batch-size=100]\nSeparate synthetic bootstrap: --bootstrap --output=/ABS/EMPTY\nDefault produces plans and read-only SQL only. JSON snapshots only; SQL dumps/CSV not accepted.'); return; }
    const args = {};
    for (const arg of argv) {
        if (arg === '--bootstrap') { if (args.bootstrap) throw Error(); args.bootstrap = true; continue; }
        const match = /^--([a-z-]+)=(.+)$/.exec(arg);
        if (!match || !allowed.includes(match[1]) || Object.hasOwn(args, match[1])) throw Error();
        args[match[1]] = match[2];
    }
    if (args.bootstrap) { if (Object.keys(args).some(k => !['bootstrap', 'output'].includes(k))) throw Error(); await syntheticBootstrap(args.output); }
    else {
        const keyFile = args.key;
        if (!keyFile || !path.isAbsolute(keyFile)) throw Error();
        privateDirectory(path.dirname(keyFile));
        // Key persists locally across runs; no default generation that silently changes identity evidence.
        const fd = fs.openSync(keyFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        let key;
        try { const s = fs.fstatSync(fd); if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid() || s.mode & 0o077 || s.size !== 32) throw Error(); key = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
        const json = file => { if (!path.isAbsolute(file)) throw Error(); privateDirectory(path.dirname(file)); return readPrivate(path.dirname(file), path.basename(file)).value; };
        const options = args.config ? json(args.config) : {};
        if (Object.keys(options).some(k => !['target', 'mappings', 'decisions', 'observations', 'scenario'].includes(k))) throw Error();
        const plan = prepare(loadSnapshot(args.input), { ...options, key });
        writePackage(args.output, plan, args.review ? json(args.review) : undefined, args['batch-size'] ? Number(args['batch-size']) : 100);
    }
    process.stdout.write('Offline package saved privately. No SQL executed.\n');
}
main().catch(() => { process.stderr.write('Offline preparation failed; check private inputs, permissions, schema, counts and review evidence. No source values logged.\n'); process.exitCode = 1; });
