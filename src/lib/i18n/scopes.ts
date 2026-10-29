/**
 * OOP-6726 — the message catalogue, sliced by route.
 *
 * The bilingual catalogue in `src/messages/` is ~50 KB per locale. Until
 * now the root layout handed the *whole* bundle to
 * `NextIntlClientProvider`, so every page — including the landing page,
 * which uses about 3 KB of it — serialised all of it into the RSC payload
 * and shipped it to every visitor.
 *
 * A "scope" is the namespace argument a component passes to
 * `useTranslations('…')` / `getTranslations('…')`: `Landing`,
 * `Landing.nav`, `Catalog.card`, `Builder.quiz`, … A route's provider
 * ships exactly the scopes that route and the components it renders use,
 * so the catalogue stops riding along on every page.
 *
 * `ROUTE_SCOPES` is the hand-maintained registry. `scopes.test.ts` scans
 * the source and asserts the registry still covers what the code actually
 * asks for — a component that starts using a new namespace fails the test
 * until the registry is updated, instead of silently rendering a raw key.
 */
import type { AbstractIntlMessages } from 'next-intl';

/**
 * The scopes the root `[locale]` layout ships.
 *
 * The root layout is an *ancestor* of every route, so whatever it provides
 * is serialised into every page's payload. It therefore carries nothing
 * but the `Common` namespace its own chrome needs: the offline banner and
 * the root-level `error.tsx` / `not-found.tsx`. Every route below it
 * provides its own, narrower provider.
 *
 * (`NextIntlClientProvider` does not merge nested providers — the nearest
 * one wins — so a route's provider must carry every scope its own tree
 * needs, including the `Common.*` scopes its error boundary uses.)
 */
export const ROOT_SCOPES = ['Common'] as const;

/**
 * Route → the message scopes that route ships.
 *
 * Keyed by the public URL path (no locale prefix — the proxy rewrites the
 * locale in and out of the URL). `src/app/[locale]/**\/layout.tsx` looks
 * its key up here and renders the scoped provider.
 */
export const ROUTE_SCOPES: Record<string, readonly string[]> = {
  '/': [
    'Catalog.card',
    'Catalog.price',
    'Landing',
    'Landing.nav',
    'Landing.waitlist',
    'Nav',
  ],
  '/browse': [
    'Catalog',
    'Catalog.browse',
    'Catalog.card',
    'Catalog.controls',
    'Catalog.price',
    'Common.error',
    'Landing.nav',
    'Nav',
  ],
  '/checkout/[giftId]': [
    'Catalog.price',
    'Checkout',
    'Checkout.errors',
    'Checkout.free',
    'Common.error',
    'Common.loading',
    'Common.notFound',
    'Landing.nav',
    'Nav',
  ],
  '/checkout/cancel': [
    'Checkout.cancel',
    'Common.error',
    'Landing.nav',
    'Nav',
  ],
  '/checkout/success': [
    'Checkout.success',
    'Common.error',
    'Landing.nav',
    'Nav',
  ],
  '/create': ['Common.error', 'Create', 'Landing.nav', 'Nav'],
  '/create/[giftId]/finish': [
    'Common.error',
    'Common.loading',
    'Common.notFound',
    'Create.finish',
    'Create.finish.share',
    'Landing.nav',
    'Nav',
  ],
  '/create/animated-letter': ['Builder.letter', 'Landing.nav', 'Nav'],
  '/create/code': ['Builder.code', 'Landing.nav', 'Nav'],
  '/create/dragdrop-puzzle': ['Builder.dragdropPuzzle', 'Landing.nav', 'Nav'],
  '/create/memory-cards': [
    'Builder.memoryCards',
    'Builder.memoryCards.pair',
    'Landing.nav',
    'Nav',
  ],
  '/create/multimedia-collage': [
    'Builder.multimediaCollage',
    'Landing.nav',
    'Nav',
  ],
  '/create/quiz': ['Builder.quiz', 'Landing.nav', 'Nav'],
  '/g/[token]': ['Recipient'],
  '/g/[token]/open': [
    'Catalog.replies',
    'Open',
    'Open.memoryCards',
    'Open.multimediaCollage',
    'Open.puzzle',
    'Open.quiz',
    'Recipient',
  ],
  '/gifts': ['Gifts', 'Landing.nav', 'Nav'],
  '/gifts/[slug]': [
    'Common.loading',
    'Common.notFound',
    'Gifts',
    'Landing.nav',
    'Nav',
  ],
  '/l/[giftId]': [
    'Catalog.comments',
    'Catalog.likeButton',
    'Catalog.listing',
    'Catalog.preview',
    'Catalog.price',
    'Catalog.replies',
    'Common.error',
    'Common.loading',
    'Common.notFound',
    'Landing.nav',
    'Nav',
  ],
  '/login': ['Auth.errors', 'Auth.login', 'Common.error'],
  '/onboarding': [
    'Common.error',
    'Landing.nav',
    'Nav',
    'Onboarding',
    'Onboarding.avatar',
    'Onboarding.connect',
    'Onboarding.handle',
  ],
  '/privacy': ['Privacy', 'Privacy.footer'],
  '/purchases': [
    'Common.error',
    'Common.loading',
    'Common.notFound',
    'Landing.nav',
    'Nav',
    'Profile.sales',
    'Purchases',
  ],
  '/settings': ['Common.error', 'Landing.nav', 'Nav', 'Settings'],
  '/signup': [
    'Auth.errors',
    'Auth.signup',
    'Auth.signup.emailStates',
    'Auth.signup.handleStates',
    'Auth.signup.passwordRules',
    'Common.error',
  ],
  '/signup/check-email': ['Auth.checkEmail', 'Common.error'],
  '/status': ['Status', 'Status.footer'],
  '/support': ['Support', 'Support.footer'],
  '/terms': ['Terms', 'Terms.footer'],
  '/u/[handle]': [
    'Catalog.card',
    'Catalog.price',
    'Common.error',
    'Common.loading',
    'Common.notFound',
    'Landing.nav',
    'Nav',
    'Profile',
    'Profile.emptyCollectionCard',
    'Profile.emptyMyGifts',
    'Profile.followButton',
    'Profile.listing',
    'Profile.sales',
  ],
  '/u/[handle]/edit': [
    'Common.error',
    'Common.loading',
    'Common.notFound',
    'Profile.edit',
    'Profile.edit.handle',
  ],
  '/u/me': ['Common.error'],
};

/**
 * The scopes registered for a route.
 *
 * Throws when the route is unknown — a layout that asks for scopes nobody
 * registered would otherwise ship an empty catalogue and render every
 * string on the page as a raw key.
 */
export function routeScopes(route: string): readonly string[] {
  const scopes = ROUTE_SCOPES[route];
  if (!scopes) {
    throw new Error(
      `[i18n] no message scopes registered for route "${route}" — ` +
        `add it to ROUTE_SCOPES in src/lib/i18n/scopes.ts`,
    );
  }
  return scopes;
}

function isMessageObject(value: unknown): value is AbstractIntlMessages {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

function mergeInto(
  target: AbstractIntlMessages,
  source: AbstractIntlMessages,
): AbstractIntlMessages {
  const out: AbstractIntlMessages = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    out[key] =
      isMessageObject(existing) && isMessageObject(value)
        ? mergeInto(existing, value)
        : value;
  }
  return out;
}

/**
 * Cut the catalogue down to the requested scopes.
 *
 * A scope is a dotted path into the message bundle: `Landing` is the whole
 * namespace, `Landing.nav` is the nav copy inside it. The result keeps the
 * same shape as the bundle, so `useTranslations('Landing.nav')` still
 * resolves against it.
 *
 * Scopes may overlap — `Catalog` and `Catalog.card` both asked for means
 * the whole namespace, so the narrower one is redundant. The merge is
 * order-independent for that reason: a namespace assigned after one of its
 * own sub-namespaces is merged in, not written over.
 */
export function pickScopes(
  messages: AbstractIntlMessages,
  scopes: readonly string[],
): AbstractIntlMessages {
  let picked: AbstractIntlMessages = {};

  for (const scope of scopes) {
    const segments = scope.split('.');

    let source: unknown = messages;
    for (const segment of segments) {
      if (!isMessageObject(source)) {
        source = undefined;
        break;
      }
      source = source[segment];
    }

    // An unknown scope is a bug in the registry, not a runtime condition
    // to paper over — `scopes.test.ts` fails on it. Skip it here so a
    // missing scope degrades to "that namespace is absent" rather than
    // taking the whole page down.
    if (source === undefined) continue;

    let node = picked;
    for (const segment of segments.slice(0, -1)) {
      if (!isMessageObject(node[segment])) node[segment] = {};
      node = node[segment] as AbstractIntlMessages;
    }

    const leaf = segments[segments.length - 1];
    const existing = node[leaf];
    node[leaf] =
      isMessageObject(existing) && isMessageObject(source)
        ? mergeInto(existing, source)
        : (source as AbstractIntlMessages | string);
  }

  return picked;
}
