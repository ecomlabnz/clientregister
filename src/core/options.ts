/**
 * Turning what somebody typed into a box back into the thing they picked.
 *
 * **The other half of `findBox`.** A `<select>` posts an id, because the id
 * was the option's value. A type-to-find box cannot: the value has to be the
 * line the person reads, or the browser has nothing to filter on. So the form
 * posts "RV. Partner — VUONG, Bao Long (CASE-26-014)" and this turns it back
 * into a matter.
 *
 * That is a real cost of the change and it is written down here rather than
 * left to be discovered: **the form now posts a label, and the label is not
 * unique by construction — the reference on the end of it is.** Everything
 * below is about being exact where it can be and refusing where it cannot,
 * rather than guessing and attaching a quotation to the wrong person's matter.
 *
 * ## What is accepted, most exact first
 *
 * 1. The id itself. A link that presets the box, or a form posted by
 *    something other than a person. See below — this one is a decision.
 * 2. The line, exactly as offered. The ordinary case: somebody clicked.
 * 3. The line, ignoring case and surrounding space. Somebody retyped it.
 * 4. A reference on its own — `CASE-26-014`, `CL-0123`, in any case. This is
 *    the one to type when the list is not there to click: a person reading off
 *    a file has the reference in front of them.
 * 5. Any fragment that appears in exactly one line. "nguyen" when there is one
 *    Nguyen; a partial reference; half a company name.
 *
 * A fragment matching several lines is **refused, not guessed**. A quotation
 * that silently attached itself to the wrong matter would be found by the
 * client, not by us.
 *
 * ## The id is accepted too, and that is a decision
 *
 * Named here rather than left to be found, because a field that takes a value
 * in two shapes is exactly the thing this codebase does not keep by accident.
 *
 * It is not a leftover. **Both shapes are current.** The id is what the
 * database holds, what a link carries — `/quotes/new?client_id=…` presets this
 * very box — and what anything posting a form on its own behalf has. The label
 * is what a person types. Refusing the id would mean a link that fills the box
 * produces a form that cannot be submitted, and on a live register that is a
 * page of somebody's typing lost to tidiness.
 *
 * What keeps it small: it is one line, in one function, checked first because
 * it is the exact form; nothing anywhere else knows about it. What would let
 * it go: nothing wanting to. This is the shape the field has, not a step on
 * the way to another one.
 */

export interface OptionLike { value: string; label: string }

export type Match =
  /** Resolved. `value` is null when the box was left empty and may be. */
  | { found: true; value: string | null }
  /** Not resolved. `ambiguous` separates "several" from "none", so the
   *  message can say which. */
  | { found: false; ambiguous: boolean };

function tidy(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** The reference a label carries in brackets on the end, if it has one. */
function refOf(label: string): string | null {
  const m = /\(([^()]+)\)\s*$/.exec(label);
  return m ? m[1]!.trim().toLowerCase() : null;
}

export function matchOption(
  typed: string | null | undefined, options: OptionLike[],
): Match {
  const text = tidy(typed);
  if (!text) return { found: true, value: null };

  // The id, exactly. First because it is the least ambiguous thing that can
  // arrive, and because a preset link carries one. See the note above.
  const byId = options.find((o) => o.value === text);
  if (byId) return { found: true, value: byId.value };

  const exact = options.find((o) => o.label === text);
  if (exact) return { found: true, value: exact.value };

  const lower = text.toLowerCase();

  const insensitive = options.filter((o) => tidy(o.label).toLowerCase() === lower);
  if (insensitive.length === 1) return { found: true, value: insensitive[0]!.value };

  // A reference on its own, which is what somebody reading off a file types.
  const byRef = options.filter((o) => refOf(o.label) === lower);
  if (byRef.length === 1) return { found: true, value: byRef[0]!.value };

  const contains = options.filter((o) => tidy(o.label).toLowerCase().includes(lower));
  if (contains.length === 1) return { found: true, value: contains[0]!.value };
  if (contains.length > 1) return { found: false, ambiguous: true };

  return { found: false, ambiguous: false };
}

/**
 * The sentence to put in front of somebody when it did not resolve.
 *
 * Says what they typed back to them, because the box is about to be redrawn
 * and a message that does not name the thing it is complaining about is a
 * message they have to guess at.
 */
export function matchProblem(
  typed: string | null | undefined, what: string, ambiguous: boolean,
): string {
  const text = tidy(typed);
  return ambiguous
    ? `More than one ${what} matches “${text}”. Pick one from the list, or type its reference.`
    : `No ${what} matches “${text}”. Pick one from the list, or type its reference.`;
}

/**
 * Read a picked option off a form, putting any problem on the field itself.
 *
 * Lives here rather than as a method on `FormReader`, which says at the top of
 * its file that it is deliberately dependency-free — and this needs to know
 * what a list of choices is. So it is written the other way round: it takes
 * only the two pieces of a form reader it actually uses, and `core/validate.ts`
 * stays as it was.
 *
 * Writing into `errors` directly is the pattern the routes already use for a
 * check the reader cannot make on its own — a case type against the practice's
 * vocabulary, for one — and `valid` is derived from `errors`, so a failure
 * here stops the write like any other.
 */
export interface FieldErrors {
  errors: Record<string, string>;
  optional(name: string, opts: { max?: number }): string | null;
}

export function readChoice(
  f: FieldErrors, name: string, options: OptionLike[],
  opts: { required?: boolean; label?: string } = {},
): string | null {
  const label = opts.label ?? name;
  // Generous, because what comes back is a whole line — "EMP. Employer
  // Accreditation — ACME PACKING LIMITED (CASE-26-021)" is 63 characters
  // before anybody has a long name.
  const typed = f.optional(name, { max: 300 });
  const match = matchOption(typed, options);
  if (!match.found) {
    if (!(name in f.errors)) f.errors[name] = matchProblem(typed, label.toLowerCase(), match.ambiguous);
    return null;
  }
  if (match.value === null && opts.required) {
    if (!(name in f.errors)) f.errors[name] = `${label} is required.`;
    return null;
  }
  return match.value;
}
