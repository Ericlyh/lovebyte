# Bundle analysis

What the landing page actually ships, and which of it the app can cut.

OOP-6725 wired the bundle analyzer and cut the browser polyfills. This
document is the artifact: the numbers, how to reproduce them, and — more
usefully for whoever picks this up next — **which bytes are the app's to
remove and which are not.**

## Reproducing

```bash
pnpm analyze          # Turbopack's analyzer over a production build
pnpm analyze:webpack  # @next/bundle-analyzer, over a webpack build
```

Two commands, because they are two different bundlers.

`pnpm analyze` is the one that matters. It runs Next's own Turbopack
analyzer and writes `.next/diagnostics/analyze/` — a treemap of the
bundle that was actually built. Its numbers match what is deployed, so
they can be compared against a Lighthouse run against production.

`pnpm analyze:webpack` builds with `--webpack` for `@next/bundle-analyzer`,
which is wired into `next.config.ts` behind `ANALYZE=true`. It is there
because the package was asked for by name, but **it cannot be the primary
analysis**: `@next/bundle-analyzer` is a webpack plugin and this app
builds with Turbopack. The package detects `process.env.TURBOPACK`,
prints "The Next Bundle Analyzer is not compatible with Turbopack builds,
no report will be generated", and returns the config untouched. The
webpack build is also a different chunk graph, so its numbers do not
describe production.

## What the landing page ships

Production, `lovorithm.vercel.app`, commit `6945626`, measured with
Lighthouse 12.8.2 (mobile emulation, one run):

| script | what it is | transfer | raw |
|---|---|---:|---:|
| `3wqcvwjgecer9.js` | react-dom + Next client runtime | 72,766 | 227,139 |
| `20o5891b8mf6h.js` | Next app-router runtime | 45,873 | 165,152 |
| `0ibe6spq7r3j-.js` | next-intl ICU runtime | 12,986 | 39,815 |
| `0f4-vj1vgy9me.js` | nav, mobile drawer, language toggle | 10,921 | 28,755 |
| `3wggy_1wa7qvl.js` | app entry | 8,359 | 29,605 |
| `turbopack-*.js` | Turbopack runtime | 4,794 | 10,986 |
| `1fl6mvkby0pey.js` | Next `useRouterBFCache` | 4,024 | 14,379 |
| `2w9l1gx47r27w.js` | `next/image` client runtime | 4,020 | 9,901 |
| `33norw237n1vi.js` | waitlist form + analytics | 3,610 | 8,658 |
| `2mk09pf27nr-1.js` | Next's built-in error page styles | 2,682 | 6,554 |
| `1-0t7sljlbf6c.js` | route error boundary | 830 | 1,115 |
| `1vzlp7vvb43tm.js` | offline banner | 792 | 1,137 |
| `3qwh2nz-5zrvo.js` | small shared chunk | 723 | 1,115 |
| **total** | | **172,380** | **544,311** |

There is also a 112,594-byte `noModule` chunk. Only browsers without
ES-module support fetch it — no browser anyone is still using — so it
costs nothing in practice, but it is 112 KiB of CDN.

## Which bytes are the app's to remove

Lighthouse's `unused-javascript` audit reported 222,620 unused raw bytes
(38.6% of 577,042) at the time of this work. Where they sat:

| chunk | unused | raw | share |
|---|---:|---:|---:|
| react-dom + Next client runtime | 87,319 | 228,410 | 38% |
| Next app-router runtime | 60,168 | 165,152 | 36% |
| next-intl ICU runtime | 26,565 | 39,809 | 67% |
| nav / mobile drawer | 8,689 | 28,736 | 30% |
| `useRouterBFCache` | 5,517 | 14,377 | 38% |
| waitlist + analytics | 4,215 | 8,658 | 49% |
| `next/image` runtime | 9,704 | 9,879 | 98% |
| Next error page styles | 2,206 | 6,552 | 34% |

**Two framework chunks account for 147,487 of the 222,620 unused bytes
(66%).** They are React DOM and the Next app-router runtime. An app that
uses Next cannot remove them; the only way to shrink them is to not use
Next.

The app's own chunks are small and already tightly scoped — the i18n
catalogue is sliced per route (`src/lib/i18n/scopes.ts`), the landing
page's catalogue preview is a server component, and there is no
third-party JavaScript on the page at all.

The one dependency-level lever worth knowing about is the **next-intl ICU
runtime** (39,809 raw / 12,986 transfer, 67% unused). `use-intl` imports
`intl-messageformat` statically, so the ICU parser is in the landing
page's chunk graph whether or not a message on that page needs parsing.
On the landing page it is not needed: the two landing-page messages with
a `{placeholder}` (`Catalog.card.by`, `Catalog.card.likesLabel`) are
rendered by a server component, so the browser never parses them.

Removing it means either replacing `use-intl`'s client runtime or
pre-resolving translations on the server and passing them down as
props. Neither is a small change, and both would make the app's i18n
unidiomatic. It is written down here rather than done, because the
trade-off is a judgement call, not a bug.

The remaining app-level unused bytes are React's own: a component's
alternate states (the waitlist form's idle/submitting/success/error
branches), the signed-in branch of the nav for an anonymous visitor, and
error boundaries that never fire. Those are what a component-based UI
looks like.

## The polyfills

Next installs nine feature-detected shims with its client entry
(`trimStart`, `trimEnd`, `Symbol.prototype.description`,
`Array.prototype.flat`, `flatMap`, `Promise.prototype.finally`,
`Object.fromEntries`, `Array.prototype.at`, `Object.hasOwn`,
`URL.canParse`) and ships them whatever the browserslist says.

Eight of the nine are redundant at this site's floor (chrome / edge /
firefox 111, safari 16.4) — every browser at that floor has them
natively. `URL.canParse` is the exception: it only landed in safari 17,
chrome 120 and firefox 115, so that one shim stays.
`scripts/turbopack-polyfill-loader.mjs` replaces the module with just
that one.

**The point of doing this is not the 1.3 KiB the shims weigh.**
Lighthouse's `legacy-javascript` audit pattern-matches polyfill
*signatures* and estimates what the equivalent core-js module graph
would weigh, so it reported 13,962 wasted bytes against a page whose
whole polyfill module was 1,380 bytes. Removing the eight redundant
signatures takes the audit to zero.

`browserslist` in `package.json` is now written out rather than left to
Next's default. It is the same floor Next applies anyway, so this
documents the support policy next to the shim that depends on it instead
of narrowing it.

## Results (commit `6945626`, production)

Lighthouse 12.8.2, mobile emulation, against `lovorithm.vercel.app`.

Content-derived audits are deterministic — they are computed from the
bundle, not from the trace — so one run is enough and four agreed:

| audit | before | after |
|---|---|---|
| `legacy-javascript` | score 0.5, **13,962** wasted bytes | score **1**, **0** wasted bytes |
| `unused-javascript` | 27,843 unused of 72,833 (38.23%) | **27,656** unused of 72,550 (38.12%) |
| `bf-cache` | score 1 | score 1 |
| `x-powered-by` | `Next.js` | absent |

The `unused-javascript` **score** went 0.5 → 0 while its byte count
improved. That is Lighthouse's `METRIC_SAVINGS` scoring, not a
regression: the mode returns 1 when the underlying score clears the pass
threshold, **0 when the audit reports any metric savings, and 0.5 when
it reports none**. The before run reported no metric savings
(`{FCP: 0, LCP: 0}`) and the after runs report 150 ms of LCP savings, so
the score flipped down even though the bundle got smaller. Read the
byte count, not the score.

The root chunk carrying the polyfills went 228,410 → 227,139 bytes raw
in production, and the page's total script transfer went 172,602 →
172,380 bytes.

Timing metrics, median of four runs after the change (the before column
is a single run, and this site is known to be noisy here — an unchanged
homepage has measured a perf score anywhere from 81 to 99 across ten
samples, which is why the repo's own gate scores the median of three):

| metric | before | after (median of 4) |
|---|---:|---:|
| perf score | 0.93 | 0.99 (0.99 in all four) |
| FCP | 1085 ms | 921 ms |
| LCP | 1975 ms | 2118 ms |
| TBT | 285 ms | 24 ms |
| max potential FID | 264 ms | 82 ms |
| CLS | 0 | 0 |

**Do not attribute the TBT and perf-score movement to this change.** A
1.3 KiB polyfill removal cannot account for 260 ms of blocking time, and
LCP moved the *wrong* way by a consistent 143 ms across all four runs.
The LCP element is the hero paragraph — text, gated by the render
blocking CSS and the display webfont — and the timing is dominated by
when that font arrives, not by the bundle. The deterministic numbers
above are the ones this change is responsible for.

