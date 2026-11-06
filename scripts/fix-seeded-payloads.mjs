#!/usr/bin/env node
/**
 * fix-seeded-payloads.mjs — make the seeded catalogue's payloads match the
 * schemas the app validates them with (OOP-7451, OOP-6753).
 *
 * Four of the seeded listings carried payloads their OWN schema rejects,
 * so the gift could not be opened by its recipient — the recipient page
 * falls back to "this gift hasn't been shipped yet". The catalogue
 * preview (OOP-7451) renders the same components, so it showed the same
 * thing: "This gift has nothing to preview yet".
 *
 * The four defects:
 *
 *   • the letter's `paper` was 'linen' and its `envelope_color` was a
 *     hex colour — the schema allows 'cream|kraft|lined' and
 *     'honey|blush|sky'. (The seed SQL already had the right values;
 *     the live row had drifted from it.)
 *   • the collage's media `position` values were 0–100; the schema wants
 *     0–1 (they are percentages of the canvas).
 *   • the memory-cards listings had two pairs — the schema wants at
 *     least three, so the game had no legal shape.
 *   • …and their `card_back` held a colour ('cream', 'kraft') where the
 *     schema wants a URL. It is optional, so it is dropped and the card
 *     falls back to the CSS gradient.
 *
 * The third pair of each memory-cards listing points at the placeholder
 * URL for the new image; `scripts/seed_catalog_covers.py` generates,
 * uploads and swaps in the real one (it matches placeholders by order).
 *
 * DML only — it runs through PostgREST with the secret key.
 *
 * USAGE
 *   node scripts/fix-seeded-payloads.mjs            # apply
 *   node scripts/fix-seeded-payloads.mjs --dry-run  # print the plan only
 *
 * The payloads it replaces are backed up to
 * `~/.paperclip/lovebyte-seeded-payloads-backup.json` before the first
 * write.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const DRY_RUN = process.argv.includes('--dry-run');

/** The third pair's placeholder, per memory-cards listing. */
const THIRD_PAIR = {
  'aaaa1111-0000-0000-0000-000000000001': {
    photo_url: 'https://placehold.co/600x600?text=dim+sum+3',
    caption: 'the last one',
  },
  'aaaa1111-0000-0000-0000-000000000002': {
    photo_url: 'https://placehold.co/600x600?text=goa+3',
    caption: 'the last light',
  },
};

/** The fix for each seeded listing's payload. */
const FIXES = {
  // The letter: the values the seed SQL has always had.
  'aaaa5555-0000-0000-0000-000000000001': (payload) => ({
    ...payload,
    paper: 'lined',
    envelope_color: 'honey',
  }),

  // The collage: positions are fractions of the canvas, not percentages.
  // The two tiles are the ones the seed SQL has — written out rather
  // than divided, so re-running the fix cannot divide them twice.
  'aaaa4444-0000-0000-0000-000000000001': (payload) => ({
    ...payload,
    media: (payload.media ?? []).map((item, index) => ({
      ...item,
      position:
        index === 0
          ? { x: 0, y: 0, w: 0.5, h: 0.5 }
          : { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    })),
  }),
};

function readEnvLocal() {
  return readFileSync(join(root, '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .reduce((acc, l) => {
      const [k, ...v] = l.split('=');
      acc[k.trim()] = v.join('=').trim();
      return acc;
    }, {});
}

const env = readEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing from .env.local');
  process.exit(2);
}

const headers = {
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  'Content-Type': 'application/json',
};

const ids = Object.keys({ ...FIXES, ...THIRD_PAIR });
const res = await fetch(
  `${url}/rest/v1/gifts?id=in.(${ids.join(',')})&select=id,title,payload`,
  { headers },
);
if (!res.ok) {
  console.error(`read failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const rows = await res.json();

const BACKUP_PATH = join(
  process.env.HOME ?? '~',
  '.paperclip',
  'lovebyte-seeded-payloads-backup.json',
);

const plan = [];
for (const row of rows) {
  const payload = row.payload ?? {};
  let next = payload;

  if (FIXES[row.id]) {
    next = FIXES[row.id](next);
  }

  const third = THIRD_PAIR[row.id];
  if (third) {
    const pairs = next.pairs ?? [];
    const alreadyThere = pairs.some((p) => p?.photo_url === third.photo_url);
    // `card_back` is dropped: it held a colour, and the schema wants a
    // URL. The card falls back to the CSS gradient when it is absent.
    const { card_back: _dropped, ...rest } = next;
    next = {
      ...rest,
      pairs: alreadyThere ? pairs : [...pairs, third],
    };
  }

  if (JSON.stringify(next) !== JSON.stringify(payload)) {
    plan.push({ id: row.id, title: row.title, payload, next });
  }
}

console.log(`${plan.length} listing(s) to fix:`);
for (const p of plan) console.log(`  ${p.title}`);

if (plan.length === 0) {
  console.log('Nothing to do — every seeded payload already matches.');
  process.exit(0);
}

if (DRY_RUN) {
  console.log('\n(dry run — nothing written)');
  process.exit(0);
}

mkdirSync(dirname(BACKUP_PATH), { recursive: true });
writeFileSync(
  BACKUP_PATH,
  JSON.stringify(
    plan.map((p) => ({ id: p.id, title: p.title, payload: p.payload })),
    null,
    2,
  ),
);
console.log(`\nBackup: ${BACKUP_PATH}`);

for (const p of plan) {
  const res = await fetch(`${url}/rest/v1/gifts?id=eq.${p.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ payload: p.next }),
  });
  if (!res.ok) {
    console.error(`  FAILED ${p.title}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`  ✓ ${p.title}`);
}

/**
 * Canonical JSON — keys sorted at every level.
 *
 * Postgres' `jsonb` does not preserve key order: it sorts them by
 * length and then alphabetically. So a plain `JSON.stringify` of what
 * came back never matches the string we sent, even when the content is
 * identical. Comparing canonically compares the CONTENT.
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const check = await fetch(
  `${url}/rest/v1/gifts?id=in.(${ids.join(',')})&select=id,payload`,
  { headers },
);
const after = await check.json();
const stale = plan.filter(
  (p) =>
    canonical(after.find((r) => r.id === p.id)?.payload) !== canonical(p.next),
);
if (stale.length > 0) {
  console.error(`\n${stale.length} listing(s) did not take the fix:`);
  for (const p of stale) console.error(`  ${p.title}`);
  process.exit(1);
}
console.log(`\nAll ${plan.length} payload(s) updated.`);
