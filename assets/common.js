/* Baranes Lab · shared helpers for the site and the admin page */
(function () {
  'use strict';
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  // Only safe link targets: http(s), mailto, tel, in-page anchors and site-relative paths.
  var safeUrl = function (u) {
    u = String(u == null ? '' : u).trim();
    if (!u) return '';
    if (/^(https?:|mailto:|tel:)/i.test(u) || /^#[\w-]*$/.test(u) || /^\/(?!\/)/.test(u)) return u;
    if (/^(assets|api)\/[\w./%-]+$/.test(u) && u.indexOf('..') < 0) return u; // files inside the site
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return 'https://' + u;
    return '';
  };
  var inline = function (s) {
    return esc(s)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, t, u) {
        var href = safeUrl(u.replace(/&amp;/g, '&'));
        return href ? '<a href="' + esc(href) + '"' + (/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : '') + '>' + t + '</a>' : t;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  };
  // Light text format: blank line = new paragraph, "- " = bullet, "1. " = numbered, **bold**, *italic*, [text](link)
  var rich = function (s) {
    var blocks = String(s == null ? '' : s).replace(/\r/g, '').split(/\n{2,}/);
    return blocks.map(function (b) {
      var lines = b.split('\n').filter(function (l) { return l.trim(); });
      if (!lines.length) return '';
      if (lines.every(function (l) { return /^\s*[-•]\s+/.test(l); }))
        return '<ul>' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*[-•]\s+/, '')) + '</li>'; }).join('') + '</ul>';
      if (lines.every(function (l) { return /^\s*\d+[.)]\s+/.test(l); }))
        return '<ol>' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*\d+[.)]\s+/, '')) + '</li>'; }).join('') + '</ol>';
      if (/^#{1,3}\s/.test(lines[0]) && lines.length === 1) return '<h3>' + inline(lines[0].replace(/^#+\s*/, '')) + '</h3>';
      return '<p>' + lines.map(inline).join('<br>') + '</p>';
    }).join('');
  };
  var isRtl = function (lang) { return /^(he|ar|fa|ur)/i.test(String(lang || '')); };
  var UI = {
    en: { menu: 'Menu', search: 'Search publications…', all: 'All years', email: 'Email', phone: 'Phone', address: 'Address', map: 'Map', more: 'More', top: 'Back to top', none: 'No results', loading: 'Loading…', close: 'Close' },
    he: { menu: 'תפריט', search: 'חיפוש בפרסומים…', all: 'כל השנים', email: 'דוא״ל', phone: 'טלפון', address: 'כתובת', map: 'מפה', more: 'עוד', top: 'חזרה למעלה', none: 'אין תוצאות', loading: 'טוען…', close: 'סגירה' },
  };
  var ui = function (lang) { return UI[String(lang || 'en').slice(0, 2)] || UI.en; };
  window.BL = { esc: esc, safeUrl: safeUrl, rich: rich, inline: inline, isRtl: isRtl, ui: ui };
})();
