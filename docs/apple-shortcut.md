# Sending a file into the register from your Mac or your phone

**Asked for on 11 September 2026:** *"may as well build the apple shortcut
option - not sure how it works but should be available."*

The register also shows these steps inside the application, at
**My account → Sending files in → How to build the shortcut**. That page and
this file say the same thing, and a test holds them together so neither can
quietly lose a step. Follow whichever is in front of you.

---

## Why this exists

Your case files live in iCloud Drive — in Finder on the Mac, in the Files app
on the phone. The register cannot reach into iCloud Drive. That is not a gap
somebody forgot to build: Apple publishes no way for any website to read your
iCloud Drive, and it is not going to.

So the file goes the other way. Instead of the register reaching in, you push
the file out. You build one small shortcut, once. After that, right-clicking a
file in Finder and choosing it sends that file straight into the register's
inbox, where you file it onto a client or a matter exactly as you file an email
that arrives.

## What a shortcut is

**Shortcuts** is an app Apple already put on your Mac and on your phone. A
shortcut is a short list of steps the computer carries out when you ask it to.
It is not programming. You drag steps into a list and fill in the boxes.

The one you are building has two steps: take the file you right-clicked, and
send it to the register.

## The token, and what it means

A shortcut cannot sign in. There is no login screen in it, nowhere to type your
password, and no way for it to prove who you are — so instead it carries a
**token**: a long line of letters and numbers that stands in for your password.

**Treat the token like a password.**
**Anyone who has it can send files into the register.**
Do not email it, do not put it in a note you share, and do not read it out.

Two things make that a smaller problem than it sounds:

* The token **can only add something to the inbox**. It cannot read a client, a
  matter, a quotation, an invoice, a file note or a document. Somebody who
  found it could send you files you did not ask for, and nothing else.
* You can **revoke it**, from **My account → Sending files in**. The moment you
  do, the shortcut carrying it stops working. If a laptop or a phone goes
  missing, that is the thing to do.

Make one token for each device, and give each one a name — *the office Mac*,
*my phone* — so that when a device is lost you know which token to revoke.

---

## Part one: get your token

1. Sign in to the register on your Mac.
2. Go to **My account** (top right), then the **Sending files in** tab.
3. In the box under **Your upload tokens**, type a name for the device you are
   about to set up. For example: `The office Mac`.
4. Press **Make an upload token**.
5. The next screen shows the token. **It is shown once and never again** — the
   register keeps only a scrambled copy of it, so nobody, including the
   register, can show it to you a second time.
6. Copy it. Paste it somewhere safe for the next five minutes — the Notes app
   will do, and you can delete it afterwards.

If you lose it, nothing is broken: revoke that token and make another.

That screen also shows **the address the shortcut sends to**. Copy that as
well. It looks like `https://…/api/ingest/shortcut`.

## Part two: build the shortcut on the Mac

1. Open the **Shortcuts** app. It is in your Applications folder.
2. Press the **+** button at the top to start a new shortcut.
3. Give it a name at the top of the window: **Send to register**.
4. On the right-hand side, click the **i** button (Shortcut Details).
   * Tick **Use as Quick Action**.
   * Under it, tick **Finder**. This is what puts the shortcut into the
     right-click menu.
   * Set **Receive** to **Files** from **Quick Actions**.
5. In the search box on the right, type `Get Contents of URL`. Drag that action
   into the empty middle of the window.
6. In the **URL** box of that action, paste the address you copied — the one
   ending `/api/ingest/shortcut`.
7. Press **Show More** underneath that action to open the rest of its settings.
8. Set **Method** to **POST**.
9. Next to **Headers**, press **+**. Two boxes appear.
   * In the left box, type: `Authorization`
   * In the right box, type `Bearer`, then a space, then paste your token.
   * It should read `Bearer ru_…` — the word Bearer, one space, then the token.
10. Set **Request Body** to **Form**.
11. Underneath, press **+** to add a field to the form.
    * Set the field's type to **File**.
    * Name the field: `file`
    * Set its value to **Shortcut Input**. (Click the value box and choose
      *Shortcut Input* from the list of variables.)
12. Close the window. Shortcuts saves as you go; there is no Save button.

That is the whole shortcut. Two steps.

### Adding a note as well (optional)

If you want to send a line of text with the file — *"passport page from the
client, 11 Sept"* — add a second field to the same form, of type **Text**, named
`note`, and type whatever you like in it. The register puts it on the inbox item
as the message.

## Part three: use it on the Mac

1. In Finder, **right-click** any file.
2. Choose **Quick Actions**, then **Send to register**.
3. Nothing visible happens. That is what success looks like.
4. Open the register and go to the **Inbox**. The file is there, with your name
   and the name you gave the token beside it.
5. File it onto a client or a matter as you would anything else. The file
   itself lands on that record as a document, and the reading can then open it.

If you want to see something happen, add a **Show Notification** action at the
end of the shortcut with `Contents of URL` as its content. The register answers
with a short sentence — *"1 file is in the register's inbox."*

## Part four: the phone

The same shortcut works on the phone if you use iCloud with the same Apple
account: shortcuts sync across your devices on their own.

1. Open **Shortcuts** on the phone.
2. Find **Send to register** and open its settings (the **i** or the ⋯ button).
3. Turn on **Show in Share Sheet**.
4. Under **Share Sheet Types**, make sure **Files** is on.

Then, in the Files app: press and hold a file → **Share** → **Send to
register**. The same is true from Mail, from Photos, and from anywhere else with
a Share button.

## What the register will and will not accept

* **Up to 10 files** in one press.
* **25 MB** per file, and 25 MB in total per press.
* **PDF, Word (.docx), plain text, Markdown, CSV, HTML, JSON, .eml, PNG, JPEG,
  GIF and WebP.** Anything else is refused, and the answer says so.
* **20 presses an hour, and 100 MB an hour**, per token. This is not a limit you
  will meet in ordinary work; it exists so that a token that has escaped cannot
  be used to fill the register with rubbish.

Everything sent this way lands in the inbox **untrusted**, like everything else
that arrives from outside. It never turns itself into a client, a matter or an
inquiry. A person decides.

## When it does not work

| What you see | What it means |
|---|---|
| *That upload token was not accepted.* | The token is wrong, mistyped, or revoked. Check the header reads `Bearer`, one space, then the token — nothing else. If in doubt, make a new token. |
| *Files must be 25 MB or smaller…* | The file is too big. Send it another way, or split it. |
| *… is a … this cannot read.* | That kind of file is not accepted. The list is above. |
| *Too many uploads for now.* | The hourly allowance for that token is used up. Wait, or use another device's token. |
| *No files arrived.* | The form field is not sending the file. Check step 11: the field's type must be **File** and its value must be **Shortcut Input**. |
| *Document storage is not switched on…* | The register's file storage is not configured. That is for whoever administers it, not for you. |

## For whoever maintains this

The endpoint is `POST /api/ingest/shortcut`, in `src/modules/shortcut/`. It
takes `multipart/form-data` with one or more file fields and an optional `note`
text field, authenticated by `Authorization: Bearer <token>`, and answers with
JSON: `{ ok, files, reference, message }`.

The token design, and the reasoning about what a leaked one can and cannot do,
is in the doc-comment at the top of `src/core/uploadtokens.ts`. Where the bytes
wait between arriving and being filed is `src/core/inboxfiles.ts`, and why they
have to wait at all is migration `0087`.
