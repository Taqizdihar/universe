const sanitizeHtml = require('sanitize-html');

const htmlOptions = {
    allowedTags: [...new Set([...sanitizeHtml.defaults.allowedTags, 'img', 'h1', 'h2', 'span'])],
    allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        '*': ['class'],
        a: ['href', 'name', 'target', 'rel'],
        img: ['src', 'alt', 'title', 'width', 'height'],
        li: ['data-list', 'style']
    },
    allowedStyles: { li: { 'list-style-type': [/^(disc|decimal)$/] } },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
        a: (_tag, attrs) => ({
            tagName: 'a',
            attribs: attrs.target === '_blank' ? { ...attrs, rel: 'noopener noreferrer' } : attrs
        })
    }
};

const urlField = /(?:^|_)(?:url|link|href|src|image)$|(?:Url|Link|Href|Src|Image)$/i;
const unsafeProtocol = /^\s*(?:(?:javascript|vbscript)\s*:|data\s*:\s*(?:text\/html|image\/svg\+xml))/i;

function sanitizePublicContent(value, key = '') {
    if (typeof value === 'string') {
        if (urlField.test(key) && unsafeProtocol.test(value)) return '';
        return /<\/?[a-z][^>]*>/i.test(value) ? sanitizeHtml(value, htmlOptions) : value;
    }
    if (Array.isArray(value)) return value.map(item => sanitizePublicContent(item));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizePublicContent(childValue, childKey)]));
    }
    return value;
}

function sanitizePublicJson(_req, res, next) {
    const sendJson = res.json.bind(res);
    res.json = body => sendJson(sanitizePublicContent(body));
    next();
}

module.exports = { sanitizePublicContent, sanitizePublicJson };
