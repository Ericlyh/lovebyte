import type { GiftType } from './schemas';

/**
 * The gift-type catalogue and the builder route that goes with each
 * entry — ONE source of truth for both (OOP-6720).
 *
 * Before this file the two lists lived apart: `GIFT_TYPES` sat in
 * `CreateDraftForm.tsx` and `BUILDER_ROUTE` sat in
 * `src/lib/actions/draft.ts`. Nothing checked that they agreed, so
 * `animated_letter` was offered in the picker with no builder route at
 * all — the creator picked it, landed on `/create/<id>/finish` with an
 * empty payload, and the publish action refused the gift with "This
 * gift has no content yet." That was the default option in the
 * dropdown, and the landing page advertises it as one of six formats.
 *
 * Now the map is typed `Record<GiftType, string>`: adding a type to
 * `GiftTypeSchema` without giving it a builder route is a TYPE ERROR,
 * not a silent dead end. `src/lib/gifts/types.test.ts` asserts the
 * same thing at runtime, and asserts that every route actually exists
 * on disk.
 */
export const GIFT_BUILDER_ROUTES: Record<GiftType, string> = {
  animated_letter: '/create/animated-letter',
  memory_cards: '/create/memory-cards',
  dragdrop_puzzle: '/create/dragdrop-puzzle',
  quiz: '/create/quiz',
  multimedia_collage: '/create/multimedia-collage',
  code: '/create/code',
};

/**
 * The order the picker renders the formats in. The first entry is the
 * dropdown's default — it must have a builder route, and it does.
 *
 * The labels are the same English strings the picker already shipped;
 * they are not translated (the picker has never been i18n'd, and
 * changing that is a separate piece of work).
 */
export const GIFT_TYPES: { value: GiftType; label: string }[] = [
  { value: 'animated_letter', label: 'Animated letter' },
  { value: 'memory_cards', label: 'Memory cards' },
  { value: 'dragdrop_puzzle', label: 'Drag-and-drop puzzle' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'multimedia_collage', label: 'Multimedia collage' },
  { value: 'code', label: 'Code' },
];

/** The picker default. Must be a type with a builder route. */
export const DEFAULT_GIFT_TYPE: GiftType = GIFT_TYPES[0].value;
