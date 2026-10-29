/**
 * UUID-shape validation that accepts LoveByte's seeded ids.
 *
 * Zod's `.uuid()` enforces RFC 4122 — the version nibble must be 1–5 and
 * the variant bits must be 8/9/a/b. LoveByte's seeded catalogue uses
 * hand-written ids like `aaaa1111-0000-0000-0000-000000000001`, which are
 * valid Postgres uuids but fail `.uuid()`. Zod rejected 8 of the 9 seeded
 * listings in the like / comment / reply paths for exactly that reason.
 *
 * This checks the SHAPE only (8-4-4-4-12 hex), which is what the database
 * actually guarantees. It is not a validity check — it never talks to the
 * database, it only decides whether a string is worth putting in a query.
 */

const UUID_SHAPE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_SHAPE_RE.test(value);
}
