/**
 * Where a form may send somebody back to.
 *
 * A `return_to` that is not checked turns every form on the site into an open
 * redirect: a link that looks like the practice's own register, posts to it,
 * and lands the person on somebody else's sign-in page. See `docs/security.md`
 * under *Redirects*.
 *
 * Lived in the tasks module until 11 September 2026, when the test-data mark
 * needed it too and an admin route importing from tasks would have been the
 * wrong way round. It is a rule about the shape of a URL and belongs to
 * nobody's feature.
 */

/** Only ever redirect to a path on this site. */
export function safeReturn(value: string | null | undefined, fallback = '/tasks'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}
