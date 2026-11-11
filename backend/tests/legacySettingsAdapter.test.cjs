const assert = require('node:assert/strict');
const { test } = require('node:test');
const fixture = require('../compatibility/fixtures/legacy-tenants.json');
const { toGlobalContent, applyGlobalOptionChanges } = require('../compatibility/settings');
const { toLegacyNavigation } = require('../compatibility/navigation');

test('global settings expose existing footer aliases and retain unknown options on edit', () => {
    const original = fixture.restaurant.settings;
    const model = toGlobalContent(original);
    assert.equal(model.identity.title, 'Sample Diner');
    assert.equal(model.footer.address, model.footer.alamat);
    assert.deepEqual(model.footer.footer_nav_1, [{ label: 'Menu', url: '/menu' }]);
    const changed = applyGlobalOptionChanges(original, [{ path: ['footer_config', 'footer_text'], value: 'New footer' }]);
    const options = JSON.parse(changed.settings.global_options);
    assert.equal(options.footer_config.footer_text, 'New footer');
    assert.deepEqual(options.footer_config.custom_footer, { hours: '09:00' });
    assert.equal(options.support_email, 'hello@example.test');
    assert.equal(JSON.parse(original.global_options).footer_config.footer_text, 'Visit us');
});

test('malformed global options are read-only, and navigation matches publication rules', () => {
    assert.equal(toGlobalContent({ global_options: '{broken' }).readOnly, true);
    assert.equal(applyGlobalOptionChanges({ global_options: '{broken' }, []).readOnly, true);
    const pages = [
        { title: 'Third', slug: 'third', status: 'published', is_in_navbar: 1, priority: 3 },
        { title: 'Draft', slug: 'draft', status: 'draft', is_in_navbar: 1, priority: 1 },
        { title: 'First', slug: 'first', status: 'published', is_in_navbar: 1, priority: 1 },
        { title: 'Hidden', slug: 'hidden', status: 'published', is_in_navbar: 0, priority: 0 }
    ];
    assert.deepEqual(toLegacyNavigation(pages), [{ title: 'First', slug: 'first' }, { title: 'Third', slug: 'third' }]);
});
