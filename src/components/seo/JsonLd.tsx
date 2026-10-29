import { serializeJsonLd, type JsonLdNode } from '@/lib/seo/jsonld';

/**
 * Renders a JSON-LD block (OOP-6728).
 *
 * The content is an ARRAY of nodes. A JSON-LD document may be an array
 * at the top level — Google expands it — and each node carries its own
 * `@context` because there is no enclosing object to hold it.
 *
 * The array also keeps each page's blocks separable: a page that emits
 * its own structured data gets ONE script element, so the page's own
 * markup is never interleaved with the site-level one.
 *
 * `dangerouslySetInnerHTML` is the only way to put raw JSON in a
 * `<script>` element. The payload is escaped first (see
 * `serializeJsonLd`), so user-authored text cannot close the element.
 */
export function JsonLd({ nodes }: { nodes: JsonLdNode[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(nodes) }}
    />
  );
}
