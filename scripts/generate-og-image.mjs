// Generate the social-share card (public/og.png) — OOP-6155.
//
// The card is a static 1200x630 PNG rendered once from an HTML mock and
// committed to the repo. It is NOT generated at request time: a static
// file is CDN-cacheable, costs no runtime, and cannot fail in prod.
//
// Design values are lifted from the live brand so the card cannot drift
// from the site:
//   - colours  → src/styles/palettes/tokens-warm-romantic.css
//   - fonts    → Norican (display) + Overlock (body), same as next/font
//   - copy     → src/messages/en.json → Landing.hero
//
// Usage:
//   node scripts/generate-og-image.mjs
//   node scripts/generate-og-image.mjs --out public/og.png
//
// Requires: Google Fonts reachable (fonts.googleapis.com) and a local
// Google Chrome (Playwright `channel: 'chrome'`).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const WIDTH = 1200;
const HEIGHT = 630;

// ------------------------------------------------------------ brand tokens
// Mirrors tokens-warm-romantic.css (the active palette).
const T = {
  primary: '#fc6b6b',
  primaryDeep: '#a83e3e',
  accent: '#ffce6c',
  blush: '#ffe8e7',
  honey: '#fff1d6',
  sage: '#3d6c0e',
  sky: '#b4e3ed',
  ink: '#3a1f1f',
  inkSoft: '#6b4a4a',
  surface: '#fffaf7',
  surfaceRaised: '#ffffff',
};

const COPY = {
  tag: 'Made in Hong Kong · 為香港而設',
  wordmark: 'Lovorithm',
  tagline: 'Send a feeling, not just a gift',
  lede: 'Turn your photos, voice notes and words into a one-of-a-kind digital gift.',
};

// ----------------------------------------------------------------- fonts
// Google Fonts CSS returns a @font-face per subset. We want the `latin`
// subset for each family/weight and embed it as a data URI so the render
// does not depend on the network at screenshot time.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function fetchFont(url) {
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const faces = [...css.matchAll(/@font-face\s*{([^}]+)}/g)].map((m) => m[1]);
  const wanted = [];
  for (const family of ['Norican', 'Overlock']) {
    for (const weight of ['400', '700']) {
      const blocks = faces.filter(
        (b) =>
          b.includes(`font-family: '${family}'`) &&
          new RegExp(`font-weight:\\s*${weight}\\b`).test(b),
      );
      // Prefer the latin subset; fall back to the first available face.
      const block =
        blocks.find((b) => b.includes('U+0000-00FF')) ?? blocks[0];
      if (!block) continue;
      const src = block.match(/url\((https:\/\/[^)]+)\)/)?.[1];
      if (!src) continue;
      const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
      wanted.push({
        family,
        weight,
        css: `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2');}`,
      });
    }
  }
  if (!wanted.length) {
    throw new Error('no Google Fonts faces fetched — cannot render the card');
  }
  return wanted;
}

// ------------------------------------------------------------------ html
function buildHtml(fontCss) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  ${fontCss.join('\n  ')}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    font-family: 'Overlock', 'Iowan Old Style', Georgia, serif;
    color: ${T.ink};
    background:
      radial-gradient(900px 520px at 88% -10%, ${T.blush} 0%, rgba(255,232,231,0) 62%),
      radial-gradient(760px 460px at 6% 108%, ${T.honey} 0%, rgba(255,241,214,0) 60%),
      linear-gradient(180deg, ${T.blush} 0%, ${T.surface} 62%);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card {
    width: 100%;
    height: 100%;
    padding: 0 96px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  /* Never let flex shrink the decorative rule — it collapses to 0px and
     silently disappears when the content column is taller than the card. */
  .card > * { flex: 0 0 auto; }
  .tag {
    display: inline-block;
    padding: 8px 20px;
    border-radius: 999px;
    background: rgba(255,255,255,0.72);
    border: 1.5px solid ${T.blush};
    color: ${T.primaryDeep};
    font-family: 'Overlock', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.04em;
    margin-bottom: 34px;
  }
  .wordmark {
    font-family: 'Norican', 'Brush Script MT', cursive;
    font-size: 136px;
    line-height: 1;
    color: ${T.primaryDeep};
    margin-bottom: 22px;
  }
  .rule {
    width: 120px;
    height: 5px;
    border-radius: 999px;
    background: ${T.accent};
    margin-bottom: 26px;
  }
  .tagline {
    font-size: 42px;
    line-height: 1.2;
    color: ${T.inkSoft};
    margin-bottom: 16px;
  }
  .lede {
    font-size: 25px;
    line-height: 1.45;
    color: ${T.inkSoft};
    max-width: 900px;
  }
</style>
</head>
<body>
  <div class="card">
    <span class="tag">${COPY.tag}</span>
    <h1 class="wordmark">${COPY.wordmark}</h1>
    <div class="rule"></div>
    <p class="tagline">${COPY.tagline}</p>
    <p class="lede">${COPY.lede}</p>
  </div>
</body>
</html>`;
}

// ----------------------------------------------------------------- main
const outArg = process.argv.indexOf('--out');
const outPath = resolve(
  ROOT,
  outArg !== -1 ? process.argv[outArg + 1] : 'public/og.png',
);

const fontCss = await fetchFont(
  'https://fonts.googleapis.com/css2?family=Norican&family=Overlock:wght@400;700&display=swap',
);
console.log(`fonts: ${fontCss.map((f) => `${f.family} ${f.weight}`).join(', ')}`);

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  await page.setContent(buildHtml(fontCss), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  // Guard the layout: the card must not overflow the 630px canvas and the
  // accent rule must still have height (flex-shrink can silently zero it).
  const m = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return {
      top: r('.tag').top,
      bottom: r('.lede').bottom,
      ruleHeight: r('.rule').height,
    };
  });
  if (m.ruleHeight < 3) throw new Error(`accent rule collapsed (${m.ruleHeight}px)`);
  if (m.top < 32 || m.bottom > HEIGHT - 32) {
    throw new Error(
      `card content overflows the canvas (top=${m.top.toFixed(0)}, bottom=${m.bottom.toFixed(0)})`,
    );
  }

  mkdirSync(dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, type: 'png' });
} finally {
  await browser.close();
}

console.log(`wrote ${outPath} (${WIDTH}x${HEIGHT})`);
