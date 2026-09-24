import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
// Production base URL — keep in sync with `src/lib/brand.ts` PRODUCTION_URL.
// Env override (`AUDIT_BASE=`) is the supported way to point this at a
// staging deploy or a custom Vercel alias without touching the source file.
const BASE = process.env.AUDIT_BASE ?? 'https://lovebyte-five.vercel.app';
const TARGETS = ['/', '/g/demo', '/browse'];
const chrome = await chromeLauncher.launch({chromeFlags: ['--headless=new', '--no-sandbox']});
for (const path of TARGETS) {
  try {
    const r = await lighthouse(`${BASE}${path}`, {port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo']});
    const c = r.lhr.categories;
    console.log(`${path}  perf=${Math.round(c.performance.score*100)} a11y=${Math.round(c.accessibility.score*100)} bp=${Math.round(c['best-practices'].score*100)} seo=${Math.round(c.seo.score*100)}`);
  } catch (e) { console.log(`${path} ERR ${e.message.slice(0,80)}`); }
}
await chrome.kill();