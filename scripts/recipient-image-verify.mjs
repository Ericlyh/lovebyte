import { chromium } from 'playwright';

/**
 * Verify the RECIPIENT pages render photos through the optimizer
 * (OOP-6723).
 *
 * The recipient pages are where the bandwidth actually lands — a
 * 12-photo collage was the heaviest thing a recipient downloaded — so
 * this checks the two of them that carry photos: the memory-cards game
 * and the multimedia collage.
 *
 * It needs two share tokens whose gifts carry a VALID payload — the
 * seeded catalogue gifts do not (their payloads predate the current
 * schemas), so they render as 404. Create a throwaway gift + share
 * for the check, then delete them.
 *
 * Usage:
 *   MEMORY_CARDS_TOKEN=<token> COLLAGE_TOKEN=<token> \
 *     node scripts/recipient-image-verify.mjs
 *   AUDIT_BASE=https://lovorithm.vercel.app node scripts/recipient-image-verify.mjs
 */
const BASE = process.env.AUDIT_BASE ?? 'http://localhost:4599';

const ROUTES = [
  {
    path: `/g/${process.env.MEMORY_CARDS_TOKEN ?? 'missing'}/open`,
    label: 'memory-cards',
    sel: '.lb-memory-card__photo',
  },
  {
    path: `/g/${process.env.COLLAGE_TOKEN ?? 'missing'}/open`,
    label: 'collage',
    sel: '.lb-multimedia__media',
  },
];

const browser = await chromium.launch({ channel: 'chrome' });

for (const route of ROUTES) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

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
    images.push({ url: res.url(), type, bytes, status: res.status() });
  });

  await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(route.sel, { timeout: 20_000 });

  const imgs = await page.$$eval(route.sel, (nodes) =>
    nodes.map((n) => ({
      src: (n.getAttribute('src') ?? '').slice(0, 90),
      srcset: (n.getAttribute('srcset') ?? '').slice(0, 110),
      sizes: n.getAttribute('sizes'),
      loading: n.getAttribute('loading'),
      // The box the browser actually laid the image out in — this is
      // what catches a `fill` that resolved against the viewport
      // instead of its container.
      box: (() => {
        const r = n.getBoundingClientRect();
        return `${Math.round(r.width)}x${Math.round(r.height)}`;
      })(),
      natural: `${n.naturalWidth}x${n.naturalHeight}`,
    })),
  );

  const bytes = images.reduce((s, r) => s + r.bytes, 0);
  console.log(`\n=== ${route.label} (${route.path}) ===`);
  console.log(`  ${imgs.length} photo(s) in the DOM, ${images.length} image response(s), ${bytes}B total`);
  for (const img of imgs.slice(0, 3)) {
    console.log(`  box=${img.box} natural=${img.natural} loading=${img.loading}`);
    console.log(`    src   : ${img.src}…`);
    console.log(`    srcset: ${img.srcset}…`);
    console.log(`    sizes : ${img.sizes}`);
  }
  const types = [...new Set(images.map((r) => r.type))];
  console.log(`  formats served: ${types.join(', ')}`);
  await page.close();
}

await browser.close();
