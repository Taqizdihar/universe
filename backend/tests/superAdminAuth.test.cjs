const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    hasGlobalSuperAdminRole,
    credentialVersion,
    verificationCodeHash,
    constantTimeHexEqual
} = require('../utils/superAdminAuth');

test('global super admin access requires the reserved email and a persisted role, regardless of user ID', async () => {
    const database = {
        async execute(_sql, params) {
            return [params[0] === 9 ? [{ '1': 1 }] : []];
        }
    };
    assert.equal(await hasGlobalSuperAdminRole(database, 1, 'user@example.com'), false);
    assert.equal(await hasGlobalSuperAdminRole(database, 1, 'm.taqizdihar@gmail.com'), false);
    assert.equal(await hasGlobalSuperAdminRole(database, 9, 'M.Taqizdihar@gmail.com'), true);
});

test('verification codes are bound to email and purpose; password changes revoke old super admin tokens', () => {
    const secret = 'test-secret-with-at-least-thirty-two-characters';
    const bootstrapHash = verificationCodeHash('m.taqizdihar@gmail.com', 'bootstrap', '012345', secret);
    assert.equal(constantTimeHexEqual(bootstrapHash, verificationCodeHash('m.taqizdihar@gmail.com', 'bootstrap', '012345', secret)), true);
    assert.equal(constantTimeHexEqual(bootstrapHash, verificationCodeHash('m.taqizdihar@gmail.com', 'recovery', '012345', secret)), false);
    assert.equal(constantTimeHexEqual(bootstrapHash, 'invalid'), false);
    assert.notEqual(credentialVersion('old-password-hash', secret), credentialVersion('new-password-hash', secret));
});
