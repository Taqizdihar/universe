// =============================================================
// Database Connection Pool (Centralized)
// =============================================================
// Single source of truth for the MySQL connection pool.
// Import this module from anywhere in the backend:
//   const db = require('../server/lib/db');
// =============================================================

const mysql = require('mysql2/promise');
const net = require('node:net');
require('dotenv').config();

const requiredDbVars = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingDbVars = requiredDbVars.filter(name => !process.env[name]);
if (missingDbVars.length) {
    throw new Error(`Missing database environment variables: ${missingDbVars.join(', ')}`);
}
const dbPort = Number(process.env.DB_PORT);
if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
    throw new Error('DB_PORT must be a valid TCP port.');
}

const host = process.env.DB_HOST;
const isPrivateIPv4 = net.isIP(host) === 4 && (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host));
const isInternalHost = ['mysql', 'localhost', '127.0.0.1', '::1'].includes(host) || isPrivateIPv4;
const sslMode = process.env.DB_SSL_MODE || (isInternalHost ? 'disable' : 'verify');
if (!['disable', 'verify'].includes(sslMode)) throw new Error('DB_SSL_MODE must be disable or verify.');
const ssl = sslMode === 'verify'
    ? { rejectUnauthorized: true, ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}) }
    : undefined;

const pool = mysql.createPool({
    host,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: dbPort,
    ...(ssl ? { ssl } : {}),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 20000 // 20 seconds
});

// Verify connection on startup
pool.getConnection()
    .then(connection => {
        console.log(`[DB] ✓ Connected to ${process.env.DB_HOST}:${dbPort}/${process.env.DB_NAME}`);
        connection.release();
    })
    .catch(err => {
        console.error(`[DB] Connection failed (${err.code || 'UNKNOWN'}).`);
    });

module.exports = pool;
