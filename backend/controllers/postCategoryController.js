// =============================================================
// Post Category Controller — CRUD Operations
// =============================================================
// Manages custom post categories with strict tenant isolation.
// All queries are scoped to the active tenant_id resolved from
// the JWT token or X-Active-Tenant header override.
//
//   GET    /api/v1/post-categories       → List all categories
//   POST   /api/v1/post-categories       → Create a category
//   PUT    /api/v1/post-categories/:id   → Update a category
//   DELETE /api/v1/post-categories/:id   → Delete a category
// =============================================================

const db = require('../server/lib/db');

/**
 * Resolves the active tenant ID from the request.
 * Supports workspace switching via X-Active-Tenant header.
 */
const getTenantId = (req) => req.tenantContext.tenantId;

// =============================================================
// GET — Fetch all categories for the active tenant
// =============================================================
const getAllCategories = async (req, res) => {
    try {
        const tid = getTenantId(req);
        const [rows] = await db.execute(
            'SELECT * FROM post_categories WHERE tenant_id = ? ORDER BY name ASC',
            [tid]
        );
        res.json(rows);
    } catch (error) {
        console.error('[API ERROR] Get post categories:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// =============================================================
// POST — Create a new category
// =============================================================
const createCategory = async (req, res) => {
    try {
        const tid = getTenantId(req);
        const { name, slug } = req.body;

        // Validation
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Nama kategori wajib diisi.' });
        }

        // Auto-generate slug from name if not provided
        const finalSlug = (slug || name)
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        if (!finalSlug) {
            return res.status(400).json({ error: 'Slug tidak valid.' });
        }

        // Check for duplicate slug within the same tenant
        const [existing] = await db.execute(
            'SELECT id FROM post_categories WHERE slug = ? AND tenant_id = ?',
            [finalSlug, tid]
        );
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Kategori dengan slug ini sudah ada.' });
        }

        const [result] = await db.execute(
            'INSERT INTO post_categories (tenant_id, name, slug) VALUES (?, ?, ?)',
            [tid, name.trim(), finalSlug]
        );

        res.status(201).json({
            message: 'Category created successfully',
            id: result.insertId,
            name: name.trim(),
            slug: finalSlug
        });
    } catch (error) {
        console.error('[API ERROR] Create post category:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// =============================================================
// PUT — Update an existing category
// =============================================================
const updateCategory = async (req, res) => {
    try {
        const tid = getTenantId(req);
        const { id } = req.params;
        const { name, slug } = req.body;

        // Validation
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Nama kategori wajib diisi.' });
        }

        // Auto-generate slug from name if not provided
        const finalSlug = (slug || name)
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        if (!finalSlug) {
            return res.status(400).json({ error: 'Slug tidak valid.' });
        }

        // Check for duplicate slug within the same tenant (excluding self)
        const [existing] = await db.execute(
            'SELECT id FROM post_categories WHERE slug = ? AND tenant_id = ? AND id != ?',
            [finalSlug, tid, id]
        );
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Kategori dengan slug ini sudah ada.' });
        }

        const [result] = await db.execute(
            'UPDATE post_categories SET name = ?, slug = ? WHERE id = ? AND tenant_id = ?',
            [name.trim(), finalSlug, id, tid]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
        }

        res.json({ message: 'Category updated successfully' });
    } catch (error) {
        console.error('[API ERROR] Update post category:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// =============================================================
// DELETE — Remove a category
// =============================================================
// Note: Posts referencing this category_id will retain their
// category_id value but the LEFT JOIN will return NULL for the
// category name. Consider SET NULL FK constraint in the schema.
// =============================================================
const deleteCategory = async (req, res) => {
    try {
        const tid = getTenantId(req);
        const { id } = req.params;

        // Nullify category_id on posts that reference this category
        // to maintain referential integrity gracefully
        await db.execute(
            'UPDATE posts SET category_id = NULL WHERE category_id = ? AND tenant_id = ?',
            [id, tid]
        );

        const [result] = await db.execute(
            'DELETE FROM post_categories WHERE id = ? AND tenant_id = ?',
            [id, tid]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
        }

        res.json({ message: 'Category deleted successfully' });
    } catch (error) {
        console.error('[API ERROR] Delete post category:', error.code || error.name || 'UNKNOWN');
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory
};
