#!/usr/bin/env node
// Turn the Vite build in dist-artifact/ into the page a claude.ai artifact publishes.
// The Artifact tool wraps the page in its own <!doctype><head><body> skeleton, so the page is a
// fragment: title, the built stylesheet and module script (relative paths), and the app root.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

// The publisher refuses a literal U+FFFD; the SDK bundle has one inside string/regex literals,
// where the escape sequence means the same character.
for (const f of readdirSync('dist-artifact/assets').filter((n) => n.endsWith('.js'))) {
  const p = `dist-artifact/assets/${f}`;
  const src = readFileSync(p, 'utf8');
  if (src.includes('\uFFFD')) writeFileSync(p, src.replaceAll('\uFFFD', '\\uFFFD'));
}

const html = readFileSync('dist-artifact/index.html', 'utf8');
const tags = [...html.matchAll(/<(?:script|link)\b[^>]*(?:><\/script>|>)/g)]
  .map((m) => m[0])
  .filter((t) => !/rel="icon"/.test(t));
const page = ['<title>Munchkin Card Game</title>', ...tags.filter((t) => t.startsWith('<link')), '<div id="app"></div>', ...tags.filter((t) => t.startsWith('<script'))].join('\n');
writeFileSync('dist-artifact/page.html', page + '\n');
console.log(page);
