const assert = require('node:assert/strict');
const { test } = require('node:test');
const fixture = require('../compatibility/fixtures/legacy-tenants.json');
const { collectLegacyMediaReferences, toMediaIdentity } = require('../compatibility/media');
const { toEditorModel, toLegacyContent } = require('../compatibility/content');

test('media references are located without rewriting links or content', () => {
    const raw = fixture.restaurant.page.content;
    const refs = collectLegacyMediaReferences(raw);
    assert.deepEqual(refs, [{ path: [0, 'data', 'hero_image'], kind: 'url', value: '/uploads/hero.jpg' }]);
    assert.deepEqual(toMediaIdentity(fixture.restaurant.media), fixture.restaurant.media);
    const complex = fixture.complex.content;
    const complexRefs = collectLegacyMediaReferences(complex);
    assert.equal(complexRefs.length, 1);
    assert.equal(complexRefs[0].value, 'data:image/png;base64,AAAA');
    assert.equal(toLegacyContent(toEditorModel(raw)), raw);
    assert.equal(toLegacyContent(toEditorModel(complex))[0].data.cta_buttons[0].link, 'https://example.test/open');
    assert.deepEqual(collectLegacyMediaReferences({ featured_image_id: 301, file_url: 'https://cdn.example.test/file.jpg', cta_url: '/buy' }).map(r => r.kind), ['id', 'url']);
    assert.deepEqual(collectLegacyMediaReferences({ images: ['/uploads/one.jpg'], cta_url: '/buy' }), [{ path: ['images', 0], kind: 'url', value: '/uploads/one.jpg' }]);
});
