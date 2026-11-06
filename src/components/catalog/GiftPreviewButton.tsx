'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CatalogGift } from '@/lib/catalog';
import { GiftPreviewDialog } from './GiftPreviewDialog';

/**
 * The "Preview" button on a catalogue card (OOP-7451).
 *
 * The button lives here rather than inside `GiftCardView` because it is
 * interactive: it opens a modal, so it needs client state. `GiftCardView`
 * stays presentational and takes the button as a slot, which keeps the
 * server-rendered grids (`/u/[handle]`, the landing page) free of it.
 */
export function GiftPreviewButton({ gift }: { gift: CatalogGift }) {
  const t = useTranslations('Catalog.preview');
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="lb-btn lb-btn--ghost lb-preview-btn"
        onClick={() => setOpen(true)}
      >
        {t('cta')}
      </button>
      {open ? <GiftPreviewDialog gift={gift} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
