const { parseLegacyContent, applyEditorChanges, toLegacyContent } = require('./content');
const footerFields = ['copyright_text', 'footer_text', 'social_links', 'footer_nav_1', 'footer_nav_2', 'footer_contacts', 'google_maps_url', 'address'];
function toGlobalContent(settings) {
    const parsed = parseLegacyContent(settings?.global_options ?? {});
    const objectOptions = !parsed.readOnly && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value);
    const options = objectOptions ? parsed.value : {};
    const footer = options.footer_config && typeof options.footer_config === 'object' && !Array.isArray(options.footer_config) ? options.footer_config : {};
    return {
        readOnly: parsed.readOnly || !objectOptions,
        reason: parsed.reason || (!objectOptions ? 'global_options must be a JSON object.' : undefined),
        identity: { site_name: settings?.site_name ?? null, title: settings?.site_name ?? null, tagline: settings?.tagline ?? null, logo_url: settings?.logo_url ?? null },
        frontend_url: options.frontend_url ?? '', support_email: options.support_email ?? '',
        footer: Object.fromEntries(footerFields.map(key => [key, footer[key] ?? (key === 'google_maps_url' ? null : key.startsWith('footer_nav') || key === 'social_links' || key === 'footer_contacts' ? [] : '')]).concat([['alamat', footer.address ?? '']])),
        original: settings
    };
}
function applyGlobalOptionChanges(settings, changes) {
    const parsed = parseLegacyContent(settings?.global_options ?? {});
    if (parsed.readOnly || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return { readOnly: true, reason: parsed.reason || 'global_options must be a JSON object.', settings };
    const model = applyEditorChanges(settings?.global_options ?? {}, changes, { kind: 'settings' });
    return { readOnly: model.readOnly, settings: { ...settings, global_options: toLegacyContent(model) } };
}
module.exports = { toGlobalContent, applyGlobalOptionChanges, footerFields };
