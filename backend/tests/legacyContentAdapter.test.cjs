const assert = require('node:assert/strict');
const { test } = require('node:test');
const fixtures = require('../compatibility/fixtures/legacy-tenants.json');
const { parseLegacyContent, toEditorModel, applyEditorChanges, toLegacyContent, validateLegacyRoundTrip } = require('../compatibility/content');
const { sanitizePublicContent } = require('../utils/publicContent');

test('page block JSON round-trips without losing unknown metadata or array order', () => {
    const raw = fixtures.restaurant.page.content;
    const model = toEditorModel(raw, { kind: 'page' });
    assert.equal(model.format, 'json-array-text');
    assert.equal(model.blocks[0].id, 'hero-1');
    assert.equal(model.kind, 'page');
    assert.equal(validateLegacyRoundTrip(raw, toLegacyContent(model)).safe, true);
    const edited = applyEditorChanges(raw, [{ path: [0, 'data', 'headline'], value: 'New heading' }], { kind: 'page' });
    const parsed = JSON.parse(toLegacyContent(edited));
    assert.equal(parsed[0].data.headline, 'New heading');
    assert.deepEqual(parsed[0].data.cta_buttons, [{ text: 'View Menu', link: '/menu' }]);
    assert.deepEqual(parsed[0].data.custom_property, { animation: 'fade-in' });
    assert.equal(parsed[0].data.hero_image, '/uploads/hero.jpg');
    assert.equal(parsed[0].id, 'hero-1');
    assert.equal(JSON.parse(raw)[0].data.headline, 'Welcome to Sample Diner');
});

test('custom, article, event, announcement and unknown fields remain lossless', () => {
    const contentSamples = [fixtures.complex.content, ...fixtures.organization.posts.map(p => p.content),
        { nested: [null, true, { body: '<p>Rich <strong>text</strong></p>' }] }];
    for (const raw of contentSamples) {
        const model = toEditorModel(raw, { kind: 'post' });
        assert.equal(model.readOnly, false);
        assert.equal(validateLegacyRoundTrip(raw, toLegacyContent(model)).safe, true);
    }
    const raw = fixtures.complex.content;
    const edited = applyEditorChanges(raw, [{ path: [0, 'data', 'nested', 0, 'label'], value: 'Changed' }]);
    const serialized = toLegacyContent(edited);
    assert.equal(serialized[0].type, 'custom_widget');
    assert.equal(serialized[0].data.nested[1].value.items[2], 'three');
    assert.equal(serialized[0].data.background_image_url, 'data:image/png;base64,AAAA');
    assert.deepEqual(serialized[0].data.cta_buttons, raw[0].data.cta_buttons);
});

test('null, HTML and malformed JSON are retained or explicitly read-only', () => {
    for (const raw of [null, undefined, '<p>Legacy <strong>HTML</strong></p>', '{broken']) {
        const model = toEditorModel(raw);
        assert.equal(toLegacyContent(model), raw);
        assert.equal(validateLegacyRoundTrip(raw, raw).safe, true);
        if (typeof raw === 'string') {
            assert.equal(model.readOnly, true);
            assert.equal(applyEditorChanges(raw, [{ path: ['foo'], value: 'bar' }]).readOnly, true);
        }
    }
    assert.equal(parseLegacyContent('{broken').format, 'unparsed-text');
    assert.equal(parseLegacyContent('<p>Text</p>').format, 'html-text');
    const duplicate = '{"hero":{"headline":"first","headline":"second"}}';
    assert.equal(parseLegacyContent(duplicate).readOnly, true);
    assert.equal(toLegacyContent(toEditorModel(duplicate)), duplicate);
});

test('patches reject prototype keys, array insertion and non-JSON values', () => {
    const raw = fixtures.complex.content;
    for (const change of [
        { path: [0, '__proto__'], value: {} },
        { path: [99], value: {} },
        { path: [0, 'data', 'nested', 0, 'constructor'], value: {} },
        { path: [0, 'data', 'nested'], value: undefined }
    ]) assert.throws(() => applyEditorChanges(raw, [change]), TypeError);
});

test('adapter does not bypass existing public HTML sanitization', () => {
    const raw = [{ type: 'custom', data: { html: '<p>Safe</p><script>alert(1)</script>', button_link: 'javascript:alert(1)' } }];
    assert.equal(toLegacyContent(toEditorModel(raw))[0].data.html, raw[0].data.html);
    const publicValue = sanitizePublicContent(raw);
    assert.equal(publicValue[0].data.html.includes('<script>'), false);
    assert.equal(publicValue[0].data.button_link, '');
});
