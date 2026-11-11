let schemaObserved = false;

async function missingBeforeMigration(db) {
    if (schemaObserved) return false;
    try {
        // If the token table exists, this is a broken partial migration.
        // Never silently accept old JWTs in that state.
        await db.execute('SELECT id FROM password_reset_tokens LIMIT 0');
        return false;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return true;
        throw error;
    }
}

async function currentVersion(db, userId) {
    try {
        const [rows] = await db.execute('SELECT version FROM account_auth_state WHERE user_id = ? LIMIT 1', [userId]);
        schemaObserved = true;
        const version = Number(rows[0]?.version || 0);
        if (!Number.isSafeInteger(version) || version < 0) throw new Error('Invalid account authentication version.');
        return version;
    } catch (error) {
        // Before the manual migration, existing login and sessions must continue to work.
        if (error.code === 'ER_NO_SUCH_TABLE' && await missingBeforeMigration(db)) return 0;
        throw error;
    }
}

async function bumpVersion(connection, userId) {
    await connection.execute('INSERT INTO account_auth_state (user_id, version) VALUES (?, 1) ON DUPLICATE KEY UPDATE version = version + 1', [userId]);
    schemaObserved = true;
}

async function bumpVersionIfAvailable(connection, userId) {
    try { await bumpVersion(connection, userId); return true; }
    catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE' && await missingBeforeMigration(connection)) return false;
        throw error;
    }
}

module.exports = { currentVersion, bumpVersion, bumpVersionIfAvailable };
