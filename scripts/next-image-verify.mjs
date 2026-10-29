import { chromium } from 'playwright';

/**
 * Verify the responsive image pipeline end to end (OOP-6723).
 *
 * Loads /browse in a real browser and reports what the page actually
 * asks for: the srcset the optimizer generated, the format the browser
 * chose, and the bytes that came over the wire — against the size of
 * the original object, which is what the page used to fetch.
 *
 * Usage:
 *   node scripts/next-image-verify.mjs
 *   AUDIT_BASE=https://lovorithm.vercel.app node scripts/next-image-verify.mjs
 */
const BASE = process.env.AUDIT_BASE ?? 'http://localhost:4599';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

/** Every image response the page made, with its transferred size. */
const images = [];
page.on('response', async (res) => {
  const type = res.headers()['content-type'] ?? '';
  if (!type.startsWith('image/')) return;
  let bytes = 0;
  try {
    bytes = (await res.body()).length;
  } catch {
    bytes = 0;
  }
  images.push({
    url: res.url(),
    type,
    bytes,
    status: res.status(),
    cacheControl: res.headers()['cache-control'] ?? null,
  });
});

await page.goto(`${BASE}/browse`, { waitUntil: 'networkidle' });
await page.waitForSelector('.lb-gift-card__img', { timeout: 20_000 });

const imgs = await page.$$eval('.lb-gift-card__img', (nodes) =>
  nodes.map((n) => ({
    src: n.getAttribute('src'),
    srcset: n.getAttribute('srcset'),
    sizes: n.getAttribute('sizes'),
    loading: n.getAttribute('loading'),
    width: n.getAttribute('width'),
    height: n.getAttribute('height'),
    naturalWidth: n.naturalWidth,
    naturalHeight: n.naturalHeight,
  })),
);

console.log(`\n${BASE}/browse — ${imgs.length} cover images in the DOM\n`);
for (const img of imgs.slice(0, 3)) {
  console.log('  src    :', (img.src ?? '').slice(0, 120));
  console.log('  srcset :', (img.srcset ?? '').slice(0, 200));
  console.log('  sizes  :', img.sizes);
  console.log('  loading:', img.loading, '| natural:', img.naturalWidth + 'x' + img.naturalHeight);
  console.log('');
}

console.log('image responses:');
for (const r of images.slice(0, 5)) {
  console.log(`  ${r.status} ${r.type} ${r.bytes}B  cache-control=${r.cacheControl ?? '-'}`);
  console.log(`     ${r.url.slice(0, 130)}`);
}
const total = images.reduce((sum, r) => sum + r.bytes, 0);
console.log(`\ntotal image bytes on the wire: ${total} across ${images.length} responses`);

await browser.close();
