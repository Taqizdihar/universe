const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('normal backend startup, media uploads and activity logging contain no schema DDL', () => {
    for (const file of ['server.js', 'services/loggerService.js']) {
        assert.doesNotMatch(read(file), /\b(?:CREATE|ALTER|DROP)\s+TABLE\b/i, file);
    }
    const server = read('server.js');
    assert.match(server, /app\.listen\(PORT, '0\.0\.0\.0', \(\) =>/);
    assert.doesNotMatch(server, /migrateSchema\(/);
});

test('schema changes are available only through the explicit migration script', () => {
    const script = read('scripts/migrateSchema.js');
    assert.match(script, /if \(require\.main === module\)/);
    assert.match(script, /ALTER TABLE media ADD COLUMN status/);
    assert.match(script, /CREATE TABLE IF NOT EXISTS activity_logs/);
});

test('database connection uses only supplied runtime DB variables and rejects incomplete settings', () => {
    let poolConfig;
    const load = env => vm.runInNewContext(read('server/lib/db.js'), {
        process: { env },
        module: { exports: {} },
        console: { log() {}, error() {} },
        require(name) {
            if (name === 'dotenv') return { config() {} };
            if (name === 'node:net') return require('node:net');
            if (name === 'mysql2/promise') return { createPool(config) {
                poolConfig = config;
                return { getConnection: async () => ({ release() {} }) };
            } };
            throw new Error(`Unexpected module: ${name}`);
        }
    });

    assert.throws(() => load({ DB_HOST: 'dev-mysql' }), /Missing database environment variables/);
    assert.equal(poolConfig, undefined);
    load({ DB_HOST: 'dev-mysql', DB_PORT: '3307', DB_USER: 'dev', DB_PASSWORD: 'test-only', DB_NAME: 'cms_dev' });
    assert.equal(poolConfig.host, 'dev-mysql');
    assert.equal(poolConfig.port, 3307);
    assert.equal(poolConfig.user, 'dev');
    assert.equal(poolConfig.password, 'test-only');
    assert.equal(poolConfig.database, 'cms_dev');
    assert.equal(poolConfig.ssl.rejectUnauthorized, true);
    load({ DB_HOST: 'mysql', DB_PORT: '3306', DB_USER: 'dev', DB_PASSWORD: 'test-only', DB_NAME: 'cms_dev' });
    assert.equal(poolConfig.ssl, undefined);
    load({ DB_HOST: 'remote.example.test', DB_PORT: '3306', DB_USER: 'dev', DB_PASSWORD: 'test-only', DB_NAME: 'cms_dev', DB_SSL_MODE: 'verify', DB_SSL_CA: 'test-ca' });
    assert.equal(poolConfig.ssl.rejectUnauthorized, true);
    assert.equal(poolConfig.ssl.ca, 'test-ca');
    assert.throws(() => load({ DB_HOST: 'remote.example.test', DB_PORT: '3306', DB_USER: 'dev', DB_PASSWORD: 'test-only', DB_NAME: 'cms_dev', DB_SSL_MODE: 'insecure' }), /DB_SSL_MODE/);
});
