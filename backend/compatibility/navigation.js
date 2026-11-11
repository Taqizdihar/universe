// Mirrors data.js: published navbar pages, priority ascending, title/slug only.
function toLegacyNavigation(pages) {
    return pages.filter(page => page.status === 'published' && (page.is_in_navbar === 1 || page.is_in_navbar === true))
        .map((page, index) => ({ page, index }))
        .sort((a, b) => Number(a.page.priority ?? 0) - Number(b.page.priority ?? 0) || a.index - b.index)
        .map(({ page }) => ({ title: page.title, slug: page.slug }));
}
module.exports = { toLegacyNavigation };
