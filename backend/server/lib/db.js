// =============================================================
// Database Connection Pool (Centralized)
// =============================================================
// Single source of truth for the MySQL connection pool.
// Import this module from anywhere in the backend:
//   const db = require('../server/lib/db');
// =============================================================

const mysql = require('mysql2/promise');
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

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: dbPort,
    ssl: {
        rejectUnauthorized: false
    },
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
        console.error(`[DB] ✗ Connection failed → ${process.env.DB_HOST}:${dbPort}`);
        console.error(err);
    });

module.exports = pool;
