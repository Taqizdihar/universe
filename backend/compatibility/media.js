const mediaKeys = new Set(['featured_image', 'hero_image', 'hero_image_url', 'background_image', 'background_image_url', 'logo_url', 'file_url', 'image_url', 'icon_url', 'gallery_image', 'partner_logo', 'rich_text_image', 'testimonial_image', 'features_icon', 'src']);
const mediaArrayKeys = new Set(['images', 'logos']);
const mediaIdKeys = new Set(['featured_image_id', 'media_id', 'folder_id']);
function collectLegacyMediaReferences(content) {
    const references = [];
    if (typeof content === 'string') {
        try { content = JSON.parse(content); } catch (_) { return references; }
    }
    const visit = (value, path) => {
        if (Array.isArray(value)) return value.forEach((child, index) => visit(child, [...path, index]));
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            const fieldPath = [...path, key];
            if (mediaKeys.has(key) && typeof child === 'string' && child) references.push({ path: fieldPath, kind: 'url', value: child });
            else if (mediaArrayKeys.has(key) && Array.isArray(child)) child.forEach((entry, index) => {
                if (typeof entry === 'string' && entry) references.push({ path: [...fieldPath, index], kind: 'url', value: entry });
                else visit(entry, [...fieldPath, index]);
            });
            else if (mediaIdKeys.has(key) && child != null) references.push({ path: fieldPath, kind: 'id', value: child });
            else if (child && typeof child === 'object') visit(child, fieldPath);
        }
    };
    visit(content, []);
    return references;
}
function toMediaIdentity(row) {
    return { id: row.id ?? null, filename: row.filename ?? null, file_name: row.file_name ?? null, file_url: row.file_url ?? null, folder_id: row.folder_id ?? null };
}
module.exports = { collectLegacyMediaReferences, toMediaIdentity, mediaKeys, mediaIdKeys };
