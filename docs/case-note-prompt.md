# A prompt for turning a Claude conversation into a file note

**Superseded on 6 September 2026 by
[`skills/case-to-register/SKILL.md`](skills/case-to-register/SKILL.md).** Use
that instead; this page is kept because release 1.0.2 names it, and a link in a
release note should still land somewhere.

## Why it was replaced rather than kept alongside

This was a block of text to paste at the end of a working conversation. It did
one job well — a file note plus the fields the conversation had settled — and
two things were wrong with it as the practice actually works.

It had to be found and pasted every time, which meant remembering it existed.
And it carried its own copy of the practice's case-type list, written out on
4 September, with a note saying to update it whenever the list changed in
Settings. Nobody was ever going to. A second copy of a list that lives in the
register is a copy that goes quietly wrong.

The replacement is a **skill** that sits in the practice's Claude project and
runs when asked, so there is nothing to find. It carries the same lists, plus
the visa types, the party roles, the statuses and the flag kinds — all read out
of the live register on the day it was written — and it says at the top what
would make them stale.

It also does more, because it was written against the register's own intake code
rather than from memory of it: it writes the values as the *keys* the form
matches on, it says which fields the form has boxes for and which are read and
dropped, and it separates the things the register will not take from pasted text
at all — flags, passport numbers, fees — into a list somebody works through by
hand.

## What has not changed

The rule the old prompt was built around, which is the rule for all of this:
**the AI proposes and a person presses the button.** Nothing either version
produces is applied to the register on its own.
