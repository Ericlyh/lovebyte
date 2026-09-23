import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/**
 * Generic page-level state card used by `not-found.tsx` + `loading.tsx`
 * across the app. Reuses `.lb-empty-card` geometry (icon + title + body
 * + CTA row) so the surface reads as "intentional pause", not "broken
 * page".
 *
 * Phase 9 (OOP-4225) — the typed-error acceptance criterion previously
 * only covered `/g/[token]` (slice 1, commit 7106257). This is the
 * shared primitive that the other 13 routes wrap.
 *
 * Server component — the CTA is a plain `<Link>` so the page renders
 * with no JS. For error boundaries needing `reset()` (client-only),
 * use `PageStateError.tsx`.
 */
type Props = {
  icon?: string;
  title: string;
  body?: string;
  ctaHref?: string;
  ctaLabel?: string;
  variant?: 'page' | 'inline';
  ariaLive?: 'polite' | 'assertive';
  ariaRole?: 'status' | 'alert';
  srLabel?: string;
};

export async function PageState({
  icon,
  title,
  body,
  ctaHref,
  ctaLabel,
  variant = 'page',
  ariaLive,
  ariaRole = 'status',
  srLabel,
}: Props) {
  const className =
    variant === 'inline'
      ? 'lb-empty-card lb-empty-card--inline'
      : 'lb-empty-card';

  return (
    <div
      className={className}
      role={ariaRole}
      aria-live={ariaLive}
      aria-busy={ariaLive === 'polite' ? 'true' : undefined}
    >
      {icon && (
        <div className="lb-empty-card__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <h2 className="lb-empty-card__title">{title}</h2>
      {body && <p className="lb-empty-card__body">{body}</p>}
      {ctaHref && ctaLabel && (
        <div className="lb-empty-card__actions">
          <Link href={ctaHref} className="lb-btn lb-btn--primary">
            {ctaLabel}
          </Link>
        </div>
      )}
      {srLabel && <p className="lb-sr-only">{srLabel}</p>}
    </div>
  );
}

/**
 * Convenience: build a not-found card from the `Common` namespace.
 * Each route's `not-found.tsx` calls this with no props and gets
 * a locale-aware typed 404 with a "Back home" CTA.
 */
export async function CommonNotFound() {
  const t = await getTranslations('Common.notFound');
  return (
    <PageState
      icon="🔍"
      title={t('title')}
      body={t('body')}
      ctaHref="/"
      ctaLabel={t('cta')}
      ariaRole="alert"
    />
  );
}

/**
 * Convenience: build a loading card from the `Common` namespace.
 * Pair with `aria-live="polite"` so screen readers announce the
 * transition once the real content streams in.
 */
export async function CommonLoading() {
  const t = await getTranslations('Common.loading');
  return (
    <PageState
      icon="⏳"
      title={t('title')}
      body={t('body')}
      ariaLive="polite"
      ariaRole="status"
      srLabel={t('sr')}
    />
  );
}