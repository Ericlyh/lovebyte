// One-off: dump computed colours for the elements axe flagged.
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:3100/browse', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
const out = await page.evaluate(() => {
  const r = [];
  for (const el of document.querySelectorAll('.lb-btn')) {
    const cs = getComputedStyle(el);
    const parent = el.parentElement;
    const pcs = parent ? getComputedStyle(parent) : null;
    r.push({
      tag: el.tagName,
      cls: el.className,
      text: el.textContent.trim().slice(0, 30),
      bg: cs.backgroundColor,
      color: cs.color,
      parentTag: parent?.tagName,
      parentClass: parent?.className,
    });
  }
  return r;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();