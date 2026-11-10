// Run explicitly against the selected MySQL database after reviewing DB_* settings.
const db = require('../server/lib/db');

async function migrateSchema() {
    const failures = [];

    // These were previously created during a media upload or activity log write.
    try {
        const [columns] = await db.execute("SHOW COLUMNS FROM media LIKE 'status'");
        if (columns.length === 0) {
            await db.execute("ALTER TABLE media ADD COLUMN status VARCHAR(50) DEFAULT 'ready'");
        }
    } catch (e) {
        failures.push(e);
        console.warn('[MIGRATION ERROR] Could not verify/add media.status:', e.message);
    }

    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS activity_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                user_id INT,
                actor_name VARCHAR(255),
                actor_role VARCHAR(50),
                action VARCHAR(255),
                status VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX (tenant_id)
            )
        `);
    } catch (e) {
        failures.push(e);
        console.warn('[MIGRATION ERROR] Could not create activity_logs:', e.message);
    }

    // Manual migration for user profile field
    try {
        const [columns] = await db.execute("SHOW COLUMNS FROM users LIKE 'profile_picture_url'");
        if (columns.length === 0) {
            console.log('[MIGRATION] Adding profile_picture_url to users table...');
            await db.execute('ALTER TABLE users ADD COLUMN `profile_picture_url` VARCHAR(255) DEFAULT NULL');
        }
    } catch (e) {
        failures.push(e);
        console.warn('[MIGRATION ERROR] Could not verify/add profile_picture_url column:', e.message);
    }

    // Manual migration for media display name field
    try {
        const [columns] = await db.execute("SHOW COLUMNS FROM media LIKE 'file_name'");
        if (columns.length === 0) {
            console.log('[MIGRATION] Adding file_name to media table...');
            await db.execute('ALTER TABLE media ADD COLUMN `file_name` VARCHAR(255) DEFAULT NULL');
            // Backfill: Set file_name equal to filename for all existing entries
            await db.execute('UPDATE media SET `file_name` = filename WHERE `file_name` IS NULL');
        }
    } catch (e) {
        failures.push(e);
        console.warn('[MIGRATION ERROR] Could not verify/add file_name column to media:', e.message);
    }

    // Manual migration for comments table
    try {
        const [tables] = await db.execute("SHOW TABLES LIKE 'comments'");
        if (tables.length === 0) {
            console.log('[MIGRATION] Creating comments table...');
            await db.execute(`
                CREATE TABLE comments (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    post_id INT NOT NULL,
                    tenant_id INT NOT NULL,
                    author_name VARCHAR(255) NOT NULL,
                    author_email VARCHAR(255) NOT NULL,
                    content TEXT NOT NULL,
                    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_comments_post (post_id, tenant_id, status)
                )
            `);
            console.log('[MIGRATION] ✓ comments table created.');
        }
    } catch (e) {
        failures.push(e);
        console.warn('[MIGRATION ERROR] Could not create comments table:', e.message);
    }

    // Manual migration for navbar visibility column on pages
    try {
        const [columns] = await db.execute("SHOW COLUMNS FROM pages LIKE 'is_in_navbar'");
        if (columns.length === 0) {
            console.log('[MIGRATION] Adding is_in_navbar to pages table...');
            await db.execute('ALTER TABLE pages ADD COLUMN `is_in_navbar` TINYINT(1) DEFAULT 0');
            // Backfill: Set all published pages as visible in navbar by default
            await db.execute("UPDATE pages SET `is_in_navbar` = 1 WHERE status = 'published'");
            console.log('[MIGRATION] ✓ is_in_navbar column added and backfilled.');
        }
    } catch (e) {
        failures.push(e);
        console.warn('[MIGRATION ERROR] Could not verify/add is_in_navbar column to pages:', e.message);
    }

    // Manual migration for plugins table
    try {
        const [tables] = await db.execute("SHOW TABLES LIKE 'plugins'");
        if (tables.length === 0) {
            console.log('[MIGRATION] Creating plugins table...');
            await db.execute(`
                CREATE TABLE plugins (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tenant_id INT NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    is_active TINYINT(1) DEFAULT 0,
                    config TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            // Seed initial plugins for existing tenants
            const [tenants] = await db.execute('SELECT id FROM tenants');
            for (const tenant of tenants) {
                await db.execute(`
                    INSERT INTO plugins (tenant_id, name, description, is_active) VALUES 
                    (?, 'API Webhooks', 'Kirim notifikasi otomatis ke URL eksternal saat konten berubah.', 0),
                    (?, 'Google Analytics', 'Pantau statistik pengunjung langsung dari dashboard.', 0),
                    (?, 'SEO Optimizer', 'Optimasi meta tag dan sitemap secara otomatis.', 1)
                `, [tenant.id, tenant.id, tenant.id]);
            }
            console.log('[MIGRATION] ✓ plugins table created and seeded.');
        }
    } catch (e) {
        failures.push(e);
        console.warn('[MIGRATION ERROR] Could not create plugins table:', e.message);
    }

    // Manual migration for notifications table
    try {
        const [tables] = await db.execute("SHOW TABLES LIKE 'notifications'");
        if (tables.length === 0) {
            console.log('[MIGRATION] Creating notifications table...');
            await db.execute(`
                CREATE TABLE notifications (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    tenant_id INT,
                    type VARCHAR(50) DEFAULT 'info',
                    message TEXT NOT NULL,
                    is_read TINYINT(1) DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_notif_user (user_id, is_read)
                )
            `);
            console.log('[MIGRATION] ✓ notifications table created.');
        }
    } catch (e) {
        failures.push(e);
        console.warn('[MIGRATION ERROR] Could not create notifications table:', e.message);
    }

    // Manual migration for tenant_users.status column
    try {
        const [columns] = await db.execute("SHOW COLUMNS FROM tenant_users LIKE 'status'");
        if (columns.length === 0) {
            console.log('[MIGRATION] Adding status column to tenant_users table...');
            await db.execute("ALTER TABLE tenant_users ADD COLUMN `status` VARCHAR(20) DEFAULT 'active'");
            console.log('[MIGRATION] ✓ tenant_users.status column added.');
        }
    } catch (e) {
        failures.push(e);
        console.warn('[MIGRATION ERROR] Could not add status column to tenant_users:', e.message);
    }

    // Manual migration for contact_inquiries table
    try {
        const [tables] = await db.execute("SHOW TABLES LIKE 'contact_inquiries'");
        if (tables.length === 0) {
            console.log('[MIGRATION] Creating contact_inquiries table...');
            await db.execute(`
                CREATE TABLE contact_inquiries (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tenant_id INT NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    subject VARCHAR(500) DEFAULT '',
                    message TEXT NOT NULL,
                    status ENUM('unread', 'read') DEFAULT 'unread',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_inquiry_tenant (tenant_id, status),
                    INDEX idx_inquiry_date (created_at)
                )
            `);
            console.log('[MIGRATION] ✓ contact_inquiries table created.');
        }
    } catch (e) {
        failures.push(e);
        console.warn('[MIGRATION ERROR] Could not create contact_inquiries table:', e.message);
    }

    // Manual migration: Extend comments status ENUM to include 'spam'
    try {
        const [columns] = await db.execute("SHOW COLUMNS FROM comments LIKE 'status'");
        if (columns.length > 0) {
            const currentType = columns[0].Type || '';
            if (!currentType.includes('spam')) {
                console.log('[MIGRATION] Extending comments.status ENUM to include spam...');
                await db.execute("ALTER TABLE comments MODIFY COLUMN status ENUM('pending', 'approved', 'rejected', 'spam') DEFAULT 'pending'");
                console.log('[MIGRATION] ✓ comments.status ENUM updated.');
            }
        }
    } catch (e) {
        failures.push(e);
        console.warn('[MIGRATION ERROR] Could not update comments status ENUM:', e.message);
    }

    if (failures.length) throw new Error(`${failures.length} schema migration step(s) failed`);
}

if (require.main === module) {
    migrateSchema().then(() => process.exit(0)).catch(error => {
        console.error('[MIGRATION ERROR]', error);
        process.exit(1);
    });
}

module.exports = { migrateSchema };
