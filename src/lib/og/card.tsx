import type { ReactElement } from 'react';
import { BRAND } from '@/lib/brand';

/**
 * The shared social card (OOP-6727).
 *
 * `next/og` renders through satori, which supports a small subset of
 * CSS: every element with more than one child needs an explicit
 * `display: flex`, `text-transform` does not exist (the eyebrow is
 * upper-cased in JS), and there are no media queries. Everything below
 * sticks to that subset.
 *
 * The palette is the same warm gradient the `/g/[token]` envelope card
 * uses, so a card in a WhatsApp thread looks like the same product
 * whichever surface it came from.
 */
export type OgCardProps = {
  /** The small label above the title — the gift format, or the section. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** The short line under the subtitle — a price, a creator. */
  detail?: string;
};

export function OgCard({ eyebrow, title, subtitle, detail }: OgCardProps): ReactElement {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'linear-gradient(180deg, #ffe8e7 0%, #fff1d6 60%, #fffaf7 100%)',
        fontFamily: 'serif',
        padding: 80,
        boxSizing: 'border-box',
      }}
    >
      {eyebrow ? (
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            color: '#cc5858',
            letterSpacing: 6,
            fontWeight: 700,
            marginBottom: 20,
          }}
        >
          {eyebrow.toUpperCase()}
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          fontSize: 60,
          color: '#2a1a1a',
          fontWeight: 700,
          textAlign: 'center',
          maxWidth: 1020,
          lineHeight: 1.15,
        }}
      >
        {title}
      </div>

      {subtitle ? (
        <div
          style={{
            display: 'flex',
            fontSize: 32,
            color: '#6b4a4a',
            textAlign: 'center',
            maxWidth: 940,
            lineHeight: 1.35,
            marginTop: 20,
          }}
        >
          {subtitle}
        </div>
      ) : null}

      {detail ? (
        <div
          style={{
            display: 'flex',
            fontSize: 30,
            color: '#a83e3e',
            fontWeight: 700,
            marginTop: 26,
          }}
        >
          {detail}
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          position: 'absolute',
          bottom: 56,
          fontSize: 24,
          color: '#cc5858',
          letterSpacing: 4,
          fontWeight: 700,
        }}
      >
        {BRAND.NAME}
      </div>
    </div>
  );
}
