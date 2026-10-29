import { serializeJsonLd, type JsonLdNode } from '@/lib/seo/jsonld';

/**
 * Renders a JSON-LD block (OOP-6728).
 *
 * ONE node per script element, and the element holds the node in an
 * array — a JSON-LD document may be an array at the top level, and
 * Google expands it. Each node carries its own `@context` because
 * there is no enclosing object to hold it.
 *
 * One node per element is what makes a block parseable on its own: a
 * reader that picks a single `<script type="application/ld+json">` off
 * the page gets one JSON-LD node back, not a fragment of several.
 *
 * `dangerouslySetInnerHTML` is the only way to put raw JSON in a
 * `<script>` element. The payload is escaped first (see
 * `serializeJsonLd`), so user-authored text cannot close the element.
 */
export function JsonLd({ node }: { node: JsonLdNode }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd([node]) }}
    />
  );
}
