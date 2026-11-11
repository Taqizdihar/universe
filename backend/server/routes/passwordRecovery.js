const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');

const RESPONSE = { message: 'Jika email tersebut terdaftar, tautan pemulihan akan dikirimkan.' };
const INVALID = { error: 'Tautan pemulihan tidak valid atau sudah kedaluwarsa.' };
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const validToken = token => typeof token === 'string' && /^[0-9a-f]{64}$/.test(token);

function frontendOrigin() {
    const url = new URL(process.env.FRONTEND_URL || '');
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('FRONTEND_URL must use HTTPS.');
    if (url.username || url.password) throw new Error('Invalid FRONTEND_URL.');
    return url.origin;
}

function createPasswordRecoveryRouter({ db, bcrypt, sendPasswordResetEmail, bumpVersion, superAdminEmail }) {
    const router = express.Router();
    router.use((_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        next();
    });
    const limiter = (limit, windowMs) => rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
        message: { error: 'Terlalu banyak percobaan. Coba lagi nanti.' } });

    async function ready() {
        try {
            await db.execute('SELECT id FROM password_reset_tokens LIMIT 0');
            await db.execute('SELECT user_id FROM account_auth_state LIMIT 0');
            return true;
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR') return false;
            console.error('[PASSWORD RECOVERY] Readiness check failed:', error.code || error.name || 'UNKNOWN');
            return false;
        }
    }

    async function issue(email) {
        let connection;
        let insertedId;
        try {
            const [found] = await db.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
            if (!found.length) return;
            connection = await db.getConnection();
            await connection.beginTransaction();
            const [users] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [found[0].id]);
            if (!users.length) { await connection.rollback(); return; }
            const [recent] = await connection.execute('SELECT id FROM password_reset_tokens WHERE user_id = ? AND created_at > NOW(6) - INTERVAL 60 SECOND ORDER BY id DESC LIMIT 1', [found[0].id]);
            if (recent.length) { await connection.rollback(); return; }
            const rawToken = crypto.randomBytes(32).toString('hex');
            const [inserted] = await connection.execute('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, NOW(6) + INTERVAL 30 MINUTE)', [found[0].id, tokenHash(rawToken)]);
            insertedId = inserted.insertId;
            await connection.commit();
            connection.release(); connection = null;
            // URL fragments stay in the browser and are not sent in frontend access logs.
            const resetUrl = `${frontendOrigin()}/reset-password#token=${rawToken}`;
            const sent = await sendPasswordResetEmail(email, resetUrl);
            if (sent) {
                await db.execute('UPDATE password_reset_tokens SET consumed_at = NOW(6) WHERE user_id = ? AND id < ? AND consumed_at IS NULL', [found[0].id, insertedId]);
            } else {
                await db.execute('DELETE FROM password_reset_tokens WHERE id = ?', [insertedId]);
            }
        } catch (error) {
            if (connection) await connection.rollback();
            if (insertedId) await db.execute('DELETE FROM password_reset_tokens WHERE id = ?', [insertedId]).catch(() => {});
            console.error('[PASSWORD RECOVERY] Issue failed:', error.code || error.name || 'UNKNOWN');
        } finally { if (connection) connection.release(); }
    }

    router.post('/forgot-password', limiter(8, 60 * 60 * 1000), async (req, res) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Alamat email tidak valid.' });
        if (!await ready()) return res.status(503).json({ error: 'Pemulihan kata sandi belum tersedia.' });
        // The reserved mailbox continues through the separate verified-code flow.
        res.json(RESPONSE);
        if (email !== superAdminEmail) setImmediate(() => { void issue(email); });
    });

    router.post('/reset-password/validate', limiter(30, 15 * 60 * 1000), async (req, res) => {
        const token = req.body?.token;
        if (!validToken(token)) return res.json({ valid: false });
        if (!await ready()) return res.status(503).json({ error: 'Pemulihan kata sandi belum tersedia.' });
        try {
            const [rows] = await db.execute('SELECT id FROM password_reset_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > NOW(6) LIMIT 1', [tokenHash(token)]);
            res.json({ valid: rows.length > 0 });
        } catch (error) {
            console.error('[PASSWORD RECOVERY] Validation failed:', error.code || error.name || 'UNKNOWN');
            res.status(503).json({ error: 'Pemulihan kata sandi belum tersedia.' });
        }
    });

    router.post('/reset-password', limiter(12, 15 * 60 * 1000), async (req, res) => {
        const { token, newPassword, confirmPassword } = req.body || {};
        if (!validToken(token)) return res.status(400).json(INVALID);
        if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128 || !newPassword.trim())
            return res.status(400).json({ error: 'Kata sandi baru harus berisi 12–128 karakter.' });
        if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Konfirmasi kata sandi tidak cocok.' });
        if (!await ready()) return res.status(503).json({ error: 'Pemulihan kata sandi belum tersedia.' });
        let connection;
        try {
            connection = await db.getConnection();
            await connection.beginTransaction();
            const [candidate] = await connection.execute('SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > NOW(6) LIMIT 1', [tokenHash(token)]);
            if (!candidate.length) { await connection.rollback(); return res.status(400).json(INVALID); }
            const userId = candidate[0].user_id;
            const [users] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
            if (!users.length) { await connection.rollback(); return res.status(400).json(INVALID); }
            const [rows] = await connection.execute('SELECT id FROM password_reset_tokens WHERE token_hash = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > NOW(6) FOR UPDATE', [tokenHash(token), userId]);
            if (!rows.length) { await connection.rollback(); return res.status(400).json(INVALID); }
            const hash = await bcrypt.hash(newPassword, 12);
            await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
            await bumpVersion(connection, userId);
            await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
            await connection.commit();
            res.json({ message: 'Kata sandi berhasil diatur ulang. Silakan masuk kembali.' });
        } catch (error) {
            if (connection) await connection.rollback();
            console.error('[PASSWORD RECOVERY] Completion failed:', error.code || error.name || 'UNKNOWN');
            res.status(500).json({ error: 'Gagal mengatur ulang kata sandi.' });
        } finally { if (connection) connection.release(); }
    });
    return router;
}

module.exports = { createPasswordRecoveryRouter, tokenHash, frontendOrigin };
