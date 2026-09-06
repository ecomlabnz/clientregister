# Skills for the practice's other Claude

The practice works cases in Claude — one conversation per matter — and by the
end of one, that conversation knows more about the matter than any single
document does. These are the instructions that get it out again in a shape the
register can take.

They are **not** part of the application. Nothing here runs on the Worker; each
folder is a skill the practice installs in their own Claude project.

| | What it does |
|---|---|
| [`case-to-register/`](case-to-register/SKILL.md) | Turns a working conversation about one matter into a handover for **Assistant → Open a matter**: the client and matter fields as the register's own keys, everyone involved and their role, a file note, what is still unknown, and what has to be entered by hand. |

## Keeping them true

Each skill carries copies of the practice's own vocabularies — case types, visa
types, statuses, flag kinds. Those live in the register under **Settings** and
can be changed there without a deployment, which means **a copy here goes stale
silently**. Each skill says the date its lists were read and what would make
them wrong; when a vocabulary changes in Settings, change it here too.

That is a real accommodation and it is named rather than hidden: the alternative
is the skill fetching the lists at run time, which would mean the practice's
Claude project reaching into the register, which is not something to build for
the sake of a list that changes twice a year.

## The rule they all keep

**The AI proposes; a person presses the button.** Nothing any of these produces
is written to the register on its own. Everything arrives as a form somebody
reads, corrects and submits — which is the same rule the register's own AI layer
keeps, and the reason the whole register still works with the AI switched off.
