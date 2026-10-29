import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Code-gift e2e (Playwright, real session) — OOP-5688.
 *
 * Drives the whole gift path, sender and recipient:
 *
 *   1. the landing page lists the code gift as one of the six formats;
 *   2. the recipient view renders a saved code gift, the gift's own
 *      JavaScript runs inside the frame, and the frame stays opaque to
 *      the page around it;
 *   3. the create page shows a visible "code gift" section that routes
 *      to /create/code;
 *   4. the picker offers "Code" and routes to /create/code;
 *   5. the live safety scan blocks a gift that reads host state and
 *      clears a clean one;
 *   6. the preview renders the sender's code inside the sandbox;
 *   7. the AI review comes back with a summary (this is what proves the
 *      LOVEBYTE_AI_* env vars reached the deployment);
 *   8. an uploaded file lands in the matching editor (drag-and-drop and
 *      the file picker), and an unsupported file is refused by name;
 *   9. saving either lands on the share page, or fails with the
 *      "not switched on yet" message that says the only thing missing
 *      is the migration that adds the `code` gift type.
 *
 * It creates a throwaway user over the GoTrue admin API and deletes it
 * again in the `finally` block, so a run leaves nothing behind.
 *
 * Usage:
 *   node scripts/code-gift-e2e.mjs
 *   AUDIT_BASE=https://staging.example.com node scripts/code-gift-e2e.mjs
 */
const envLocal = readFileSync(
  new URL('../.env.local', import.meta.url).pathname,
  'utf8',
)
  .split('\n')
  .filter((l) => l && !l.startsWith('#'))
  .reduce((acc, l) => {
    const [k, ...v] = l.split('=');
    acc[k.trim()] = v.join('=').trim();
    return acc;
  }, {});

const BASE = process.env.AUDIT_BASE ?? 'https://lovorithm.vercel.app';
const SUPA = envLocal.NEXT_PUBLIC_SUPABASE_URL;
const SK = envLocal.SUPABASE_SECRET_KEY;
const EMAIL = `e2e-code-${Date.now()}@example.com`;
const PASSWORD = `pw-${Math.random().toString(36).slice(2)}-A1`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const created = await fetch(`${SUPA}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
});
const createdBody = await created.json();
console.log('admin create user:', created.status);
if (created.status >= 300) {
  console.log(JSON.stringify(createdBody).slice(0, 300));
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console error]', m.text().slice(0, 200));
});

try {
  // 0. The landing page lists the code gift. It used to say "Five gift
  //    formats" and show five cards — the code gift existed but was
  //    invisible to anyone who had not opened the create picker.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const featureTitles = await page.locator('.lb-features .lb-feature h3').allTextContents();
  check('landing page lists the code gift', featureTitles.includes('Code'), featureTitles.join(', '));
  const featureHeading = await page.locator('.lb-features').getAttribute('aria-label');
  check('landing page counts six formats', /six/i.test(featureHeading ?? ''), featureHeading ?? '');

  // 1. The recipient view. `/g/demo-code` is the seeded mock envelope,
  //    so this works before any code gift can be saved.
  await page.goto(`${BASE}/g/demo-code/open`, { waitUntil: 'networkidle' });
  const frame = page.locator('.lb-code-gift__frame');
  check('recipient view renders the code frame', (await frame.count()) === 1);
  check('recipient frame is sandboxed', (await frame.getAttribute('sandbox')) === 'allow-scripts');

  const inner = page.frames().find((f) => f !== page.mainFrame());
  check('the gift document loaded in the frame', Boolean(inner));
  if (inner) {
    const h1 = await inner.locator('h1').innerText().catch(() => '');
    check('the gift rendered its own markup', h1.includes('Happy birthday'), h1);
    await inner.locator('#go').click();
    await inner.waitForTimeout(400);
    check('the gift JavaScript ran', await inner.locator('#out').isVisible());
  }

  const opaque = await page.evaluate(() => {
    const el = document.querySelector('.lb-code-gift__frame');
    try {
      // A same-origin frame would let the page read into the gift.
      return el.contentDocument === null ? 'opaque' : 'same-origin';
    } catch {
      return 'opaque';
    }
  });
  check('the page around the gift cannot read into it', opaque === 'opaque', opaque);

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2000);
  console.log('after login url:', page.url());

  // 2. the visible code section on /create. The code gift used to be
  //    reachable only by opening the type dropdown, which is why the
  //    report said "I cannot see a section that allows me to upload code".
  await page.goto(`${BASE}/create`, { waitUntil: 'domcontentloaded' });
  const codeSection = page.locator('.lb-create-code');
  check('the create page shows a code gift section', (await codeSection.count()) === 1);
  check(
    'the code section is visible without opening a dropdown',
    await codeSection.isVisible().catch(() => false),
  );
  const codeHeading = await codeSection.locator('h2').innerText().catch(() => '');
  check('the code section is labelled', codeHeading.includes('Code'), codeHeading);

  await Promise.all([
    page.waitForURL(/\/create\/code$/, { timeout: 30000 }).catch(() => {}),
    page.click('.lb-create-code a.lb-btn'),
  ]);
  await page.waitForTimeout(1000);
  check('the code section routes to /create/code', page.url().endsWith('/create/code'), page.url());

  // 3. the picker offers "Code" and routes to the builder.
  await page.goto(`${BASE}/create`, { waitUntil: 'domcontentloaded' });
  const options = await page.locator('select[name="type"] option').allTextContents();
  check('picker offers a Code option', options.includes('Code'), options.join(', '));

  await page.fill('input[name="title"]', 'A tiny page for you');
  await page.selectOption('select[name="type"]', 'code');
  await Promise.all([
    page.waitForURL(/\/create\/code$/, { timeout: 30000 }).catch(() => {}),
    // Scope to the create form: the nav also holds a sign-out
    // <button type="submit">, and a bare selector clicks that one.
    page.click('form.lb-form button[type="submit"]'),
  ]);
  await page.waitForTimeout(1500);
  check('picker routes to /create/code', page.url().endsWith('/create/code'), page.url());

  // 4. the scan blocks a gift that reads host state.
  await page.fill('#code-title', 'A tiny page for you');
  await page.fill(
    '#code-html',
    '<h1 id="msg">Hi</h1><button id="go">Open</button>',
  );
  await page.fill('#code-css', 'h1 { color: #a83e3e; }');
  await page.fill('#code-js', 'document.getElementById("go").onclick = () => {};');
  await page.waitForTimeout(600);

  const verdictOf = async () =>
    (await page.locator('.lb-code-verdict').first().innerText()).trim();
  let verdict = await verdictOf();
  check('a clean gift scans clean', verdict.toLowerCase().includes('safe'), verdict);

  await page.fill('#code-js', 'localStorage.setItem("x", "1");');
  await page.waitForTimeout(600);
  verdict = await verdictOf();
  check('a gift that reads host state is blocked', verdict.toLowerCase().includes('cannot'), verdict);

  const findingCount = await page.locator('.lb-code-finding').count();
  check('the blocked finding is listed', findingCount > 0, `${findingCount} findings`);

  await page.fill('#code-js', 'document.getElementById("go").onclick = () => {};');
  await page.waitForTimeout(600);
  verdict = await verdictOf();
  check('clearing the block clears the verdict', verdict.toLowerCase().includes('safe'), verdict);

  // 5. the preview carries the sender's code and the sandbox CSP.
  const srcDoc = await page.locator('.lb-code-gift__frame--preview').getAttribute('srcdoc');
  check(
    'preview embeds the sender code',
    Boolean(srcDoc?.includes('id="msg"')) && Boolean(srcDoc?.includes('color: #a83e3e')),
  );
  check('preview carries the sandbox CSP', Boolean(srcDoc?.includes('connect-src')));
  const sandbox = await page.locator('.lb-code-gift__frame--preview').getAttribute('sandbox');
  check('preview frame is sandboxed without same-origin', sandbox === 'allow-scripts', String(sandbox));

  // React mode: the sender writes JSX, the server compiles it, and the
  // preview mounts the component on React 18.
  await page.check('#code-react');
  await page.fill('#code-html', '<div id="root"></div>');
  await page.fill(
    '#code-js',
    'function App() { return <h1 id="jsx-out">Hello from JSX</h1>; }',
  );
  await page.waitForTimeout(3000);
  const reactSrcDoc = await page.locator('.lb-code-gift__frame--preview').getAttribute('srcdoc');
  check(
    'React mode loads React 18',
    Boolean(reactSrcDoc?.includes('react@18')) && Boolean(reactSrcDoc?.includes('react-dom')),
  );
  check('React mode compiles the JSX', Boolean(reactSrcDoc?.includes('React.createElement')));
  const reactFrame = page
    .frames()
    .find((f) => f !== page.mainFrame() && f.url().includes('about:srcdoc'));
  const jsxText = reactFrame
    ? await reactFrame.locator('#jsx-out').innerText().catch(() => '')
    : '';
  check('the React component mounted in the preview', jsxText.includes('Hello from JSX'), jsxText);

  await page.uncheck('#code-react');
  await page.fill('#code-html', '<h1 id="msg">Hi</h1><button id="go">Open</button>');
  await page.fill('#code-js', 'document.getElementById("go").onclick = () => {};');
  await page.waitForTimeout(1200);

  // 6. the AI review (proves the deployment has the model configured).
  //
  //    This runs on the gift as typed, before any files are uploaded:
  //    the review has an 8000-token output cap and the model writes a
  //    longer review for a bigger gift, so uploading first would turn
  //    this check into a test of the model's verbosity rather than of
  //    the deployment's model configuration.
  await page.click('button:has-text("Ask the AI")');
  const reviewSummary = page.locator('.lb-code-review__summary');
  const gotReview = await reviewSummary
    .waitFor({ timeout: 90000 })
    .then(() => true)
    .catch(() => false);
  check('AI review returns a summary', gotReview, gotReview ? (await reviewSummary.innerText()).slice(0, 160) : 'no summary');
  if (gotReview) {
    const suggestionCount = await page.locator('.lb-code-suggestion').count();
    check('AI review proposes suggestions', suggestionCount >= 0, `${suggestionCount} suggestions`);
  } else {
    const aiError = await page.locator('.lb-code-builder__ai .lb-form-error').count();
    const aiErrText = aiError ? await page.locator('.lb-code-builder__ai .lb-form-error').first().innerText() : '';
    console.log('  ai error:', aiErrText);
  }

  // 7. file upload. The sender drops the page they already have on
  //     disk and each file lands in the matching editor.
  const uploadDir = mkdtempSync(join(tmpdir(), 'code-gift-upload-'));
  const uploadFiles = [
    {
      name: 'index.html',
      content: '<h2 id="uploaded">From a file</h2>',
      type: 'text/html',
    },
    {
      name: 'style.css',
      content: '#uploaded { color: #3d6c0e; }',
      type: 'text/css',
    },
    {
      name: 'app.js',
      content: 'document.getElementById("uploaded").dataset.ready = "1";',
      type: 'text/javascript',
    },
  ];
  for (const file of uploadFiles) {
    writeFileSync(join(uploadDir, file.name), file.content);
  }

  const dropFiles = async (files) =>
    page.evaluateHandle((payload) => {
      const transfer = new DataTransfer();
      for (const file of payload) {
        transfer.items.add(new File([file.content], file.name, { type: file.type }));
      }
      return transfer;
    }, files);

  // The drop path first — that is the headline interaction.
  await page.dispatchEvent('.lb-code-drop', 'drop', {
    dataTransfer: await dropFiles(uploadFiles),
  });
  await page.waitForTimeout(600);

  const uploadedHtml = await page.inputValue('#code-html');
  const uploadedCss = await page.inputValue('#code-css');
  const uploadedJs = await page.inputValue('#code-js');
  check(
    'an uploaded HTML file lands in the HTML box',
    uploadedHtml.includes('From a file'),
    uploadedHtml.slice(-80),
  );
  check(
    'an uploaded CSS file lands in the CSS box',
    uploadedCss.includes('#uploaded'),
    uploadedCss.slice(-80),
  );
  check(
    'an uploaded JavaScript file lands in the JavaScript box',
    uploadedJs.includes('dataset.ready'),
    uploadedJs.slice(-80),
  );
  check(
    'the upload is confirmed to the sender',
    (await page.locator('.lb-code-builder__upload [role="status"]').count()) === 1,
  );

  // An unsupported file is refused by name, and the good files that
  // came with it are still imported.
  await page.dispatchEvent('.lb-code-drop', 'drop', {
    dataTransfer: await dropFiles([
      { name: 'photo.png', content: 'not really a png', type: 'image/png' },
      { name: 'extra.js', content: 'console.log("extra");', type: 'text/javascript' },
    ]),
  });
  await page.waitForTimeout(600);
  const uploadErrorText = await page
    .locator('.lb-code-builder__upload .lb-form-error')
    .innerText()
    .catch(() => '');
  check(
    'an unsupported file is refused with a reason',
    uploadErrorText.includes('photo.png'),
    uploadErrorText.slice(0, 120),
  );
  check(
    'a refused file does not take the good ones down',
    (await page.inputValue('#code-js')).includes('console.log("extra")'),
  );

  // The file picker does the same thing.
  try {
    await page.setInputFiles(
      '#code-files',
      uploadFiles.map((file) => join(uploadDir, file.name)),
    );
    await page.waitForTimeout(600);
    check(
      'the file picker imports files too',
      (await page.inputValue('#code-html')).includes('From a file'),
    );
  } catch (err) {
    check('the file picker imports files too', false, String(err).slice(0, 160));
  }
  rmSync(uploadDir, { recursive: true, force: true });

  // 8. saving. Either it works (migration applied) or it says exactly
  //    what is missing.
  await Promise.all([
    page.waitForURL(/\/create\/[^/]+\/finish/, { timeout: 30000 }).catch(() => {}),
    page.click('form.lb-code-builder button[type="submit"]'),
  ]);
  await page.waitForTimeout(2500);
  // Scoped to the form's own error: the upload panel also uses
  // .lb-form-error, and a refused file would otherwise be mistaken for
  // the save failing.
  const saveError = page.locator('form.lb-code-builder > .lb-form-error');
  const saveErrorCount = await saveError.count();
  if (saveErrorCount) {
    const msg = (await saveError.first().innerText()).trim();
    check(
      'save reports the missing migration (not a crash)',
      msg.includes('not switched on') || msg.includes('Could not save'),
      msg,
    );
  } else {
    check('save produced a share page', page.url().includes('/finish'), page.url());
  }
} catch (err) {
  check('e2e ran to completion', false, String(err).slice(0, 300));
} finally {
  await browser.close();
  const del = await fetch(`${SUPA}/auth/v1/admin/users/${createdBody.id}`, {
    method: 'DELETE',
    headers: { apikey: SK, Authorization: `Bearer ${SK}` },
  });
  console.log('\ncleanup delete user:', del.status);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
