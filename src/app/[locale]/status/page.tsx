import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';
import { BRAND } from '@/lib/brand';
import { BRAND_OG_IMAGE, buildMetadata } from '@/lib/seo/metadata';
import { postgrest } from '@/lib/supabase/anon';

/**
 * /status — Phase 10 (OOP-4226).
 *
 * Public status page. Reads `public.incidents` (anon SELECT policy
 * `incidents_select_public` from migration 0009). Two reads:
 *
 *   1. The most-severe OPEN incident (`resolved_at IS NULL`) drives
 *      the headline pill at the top.
 *   2. The last 7 days of incidents (open + resolved) drive the log
 *      below the pill.
 *
 * Rendering is forced dynamic via `cache: 'no-store'` in the postgrest
 * helper so a fresh row shows up within a minute (Next's default cache
 * would otherwise hold the page for 5 minutes).
 *
 * Why not `revalidate`? The write side is `POST /api/incidents` +
 * `PATCH /api/incidents/[id]` (OOP-6156), but this route is
 * `force-dynamic` and its data read is `cache: 'no-store'`, so there
 * is no cached render to invalidate — `revalidatePath` would be a
 * no-op. A newly logged incident shows up on the next request.
 */

export const metadata: Metadata = buildMetadata({
  path: '/status',
  title: 'Status',
  description: `${BRAND.NAME} system status and incident history.`,
  imageUrl: BRAND_OG_IMAGE,
});

export const dynamic = 'force-dynamic';

type IncidentSeverity = 'operational' | 'maintenance' | 'degraded' | 'outage';
type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

type Incident = {
  id: string;
  severity: IncidentSeverity;
  title: string;
  body: string | null;
  status: IncidentStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  outage: 4,
  degraded: 3,
  maintenance: 2,
  operational: 1,
};

function pickHeadline(rows: Incident[]): IncidentSeverity {
  const open = rows.filter((r) => r.resolved_at === null);
  if (open.length === 0) return 'operational';
  let best: IncidentSeverity = 'operational';
  for (const row of open) {
    if (SEVERITY_RANK[row.severity] > SEVERITY_RANK[best]) best = row.severity;
  }
  return best;
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale === 'zh-Hant' ? 'zh-HK' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export default async function StatusPage({ params }: PageProps<'/[locale]/status'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Status');
  const tFoot = await getTranslations('Status.footer');
  // `locale` above comes from the route param, and `setRequestLocale` has
  // already handed it to next-intl — a second `getLocale()` call would
  // return the same value.

  const { data, error } = await postgrest<Incident>('incidents', {
    order: 'created_at.desc',
    select:
      'id,severity,title,body,status,created_at,updated_at,resolved_at',
  });

  // Render even on read error — never let a status page 500, that
  // defeats the point. But a failed read is NOT "operational" (OOP-6154):
  // when the Supabase host does not resolve, this page used to render a
  // green "All systems operational" pill over a totally dead data layer,
  // which is exactly how a P1 stayed hidden. Report "unknown" instead.
  const allRows: Incident[] = Array.isArray(data) ? data : [];
  const readFailed = Boolean(error);
  const headline: IncidentSeverity | 'unknown' = readFailed
    ? 'unknown'
    : pickHeadline(allRows);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = allRows.filter((r) => new Date(r.created_at).getTime() >= cutoff);

  const headlineText =
    headline === 'unknown'
      ? t('overallUnknown')
      : headline === 'operational'
        ? t('overallOperational')
        : headline === 'maintenance'
          ? t('overallMaintenance')
          : headline === 'degraded'
            ? t('overallDegraded')
            : t('overallOutage');

  const headlineDotClass = `lb-status-dot lb-status-dot--${
    headline === 'operational' ? 'ok' : headline === 'outage' ? 'down' : 'warn'
  }`;

  const lastUpdated = new Intl.DateTimeFormat(
    locale === 'zh-Hant' ? 'zh-HK' : 'en-GB',
    { dateStyle: 'medium', timeStyle: 'short' },
  ).format(new Date());

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="lb-nav">
        <Link href="/" className="lb-nav__brand">{BRAND.NAME}</Link>
        <div className="lb-nav__links">
          <LanguageToggle />
        </div>
      </nav>

      <section className="lb-status-page">
        <header className="lb-status-header">
          <h1>{t('title')}</h1>
          <p className="lede">{t('lede')}</p>
        </header>

        {/* data-status-state is the machine-readable contract: the readiness
            gate (scripts/readiness-gate.mjs) reads it to tell "the live
            incident read succeeded" apart from "the page rendered while the
            data layer was dead". Keep it in sync with `headline`. */}
        <div
          className="lb-status-overall"
          aria-live="polite"
          data-status-state={headline}
        >
          <span className={headlineDotClass} aria-hidden="true" />
          <span className="lb-status-overall-text">{headlineText}</span>
          <span className="lb-status-overall-time">
            {t('updatedAt', { time: lastUpdated })}
          </span>
        </div>

        <div className="lb-status-section">
          <h2>{t('last7')}</h2>
          {readFailed ? (
            <p className="lb-status-empty">{t('statusUnavailable')}</p>
          ) : recent.length === 0 ? (
            <p className="lb-status-empty">{t('noIncidents')}</p>
          ) : (
            recent.map((row) => {
              const sevClass =
                row.severity === 'outage'
                  ? 'lb-incident--down'
                  : row.severity === 'operational' && row.resolved_at
                    ? 'lb-incident--ok'
                    : '';
              const statusLabel = t(row.status);
              return (
                <article key={row.id} className={`lb-incident ${sevClass}`}>
                  <div className="lb-incident__title">{row.title}</div>
                  <div className="lb-incident__meta">
                    <span className="lb-incident__status">{statusLabel}</span>
                    <span>
                      {row.resolved_at
                        ? t('resolvedAt', { time: formatDate(row.resolved_at, locale) })
                        : t('inProgress')}
                    </span>
                  </div>
                  {row.body ? <div className="lb-incident__update">{row.body}</div> : null}
                </article>
              );
            })
          )}
        </div>

        <nav className="lb-landing-foot" aria-label="Status footer">
          <p>
            <Link href="/">{tFoot('home')}</Link>
            {' · '}
            <Link href="/support">{tFoot('support')}</Link>
            {' · '}
            <Link href="/privacy">{tFoot('privacy')}</Link>
          </p>
        </nav>
      </section>
    </main>
  );
}
