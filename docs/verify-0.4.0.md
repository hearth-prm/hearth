# Verifying 0.4.0 (M4 — mapping settings + record sharing)

0.4.0 is cut **only after this passes against real Google accounts**. Run this
checklist **before** [verify-0.5.0.md](verify-0.5.0.md): M5 changes the same sync
engine, so a failure there is far easier to place against a sharing setup already
known to work.

Everything below is a manual test, because the parts that can break in production are
exactly the parts a fake API client cannot prove: consent scopes, Google's wholesale
field replacement, and two real address books converging on one Hearth record.

## Setup

| | |
|---|---|
| **A** | you — owner of the records under test |
| **B** | second Google account (your wife), a separate Hearth user |

- Both signed in to the same Hearth install at least once, so both appear in pickers.
- Both granted contacts **and** calendar scopes — check **Settings** shows
  `Contacts permission`, `Calendar permission` and `Offline access` for each.
- Have **Google Contacts** and **Google Calendar** open for both accounts, in
  separate browser profiles. Two tabs in one profile will silently show you one
  account twice, which is the easiest way to get a false pass on the whole of §3.
- Contacts sync is **not instant.** Google's People API has taken minutes to reflect
  a write on this install before. When a check fails, re-check after five minutes
  before recording it as a failure.

---

## 0 — Upgrade safety

The `PersonSync` migration moves every Google link off the `Person` row. If it
mis-migrates, Hearth forgets which Google contact belongs to which record and
re-creates all of them. Test 0.2 is the one that catches that, and it is the single
most important test on this page.

| # | Test | Expected |
|---|---|---|
| 0.1 | Before updating, note 3 synced contacts and their Google entries | — |
| 0.2 | Update, wait for a sync cycle, re-open Google Contacts | **No duplicates.** The same 3 entries, updated in place |
| 0.3 | Those contacts' badges in Hearth | Still `Synced`, not back to `Pending` |
| 0.4 | Container logs during boot | Migration applied, no error, no destructive statement |
| 0.5 | Footer / Settings version | `0.4.0` |
| 0.6 | Existing events still linked | "Open in Google Calendar" still resolves |

---

## 1 — Field ↔ Google mapping settings (M4a)

Google's `updatePersonFields` **replaces** each named field group wholesale, so
disabling a mapping genuinely clears the remote value rather than leaving it
stranded. That is what 1.4 and 1.8 are really testing.

| # | Test | Expected |
|---|---|---|
| 1.1 | Open **Settings → Mappings → Contacts** (`/settings/mappings/people`) | Loads, lists core and custom fields |
| 1.2 | Open **Settings → Mappings → Events** (`/settings/mappings/events`) | Loads |
| 1.3 | Structural core fields (name, emails, phones) | **No** toggle — they are not optional |
| 1.4 | Turn off a disableable core field (Birthday), edit the contact, sync | Birthday **gone** from the Google contact |
| 1.5 | Turn it back on, edit, sync | Birthday returns |
| 1.6 | Add a custom contact field, set a value, sync, **without** mapping it | Value does **not** appear in Google |
| 1.7 | Map that field to a Google target, edit, sync | Value appears at the mapped target |
| 1.8 | Unmap it, edit, sync | Value **disappears** from Google |
| 1.9 | Map two custom fields to the same append-only target | **Both** values present, neither overwrites the other |
| 1.10 | Map a custom **event** field, tick send-to-Google, sync | Value present on the Google event |
| 1.11 | Sign in as B, open B's mapping page | Shows **B's** fields only — none of A's |
| 1.12 | Change a mapping as B | A's records serialize unchanged |
| 1.13 | Archive a custom field that is mapped | No crash; page still loads |

---

## 2 — Sharing mechanics (M4b)

| # | Test | Expected |
|---|---|---|
| 2.1 | Every share form | A **checkbox list of users** — no email box anywhere |
| 2.2 | Your own row in your own picker | Absent |
| 2.3 | Tick two users, submit **once** | Both granted; message names both |
| 2.4 | Re-open the form | Existing recipients labelled `already has access` |
| 2.5 | Untick an existing recipient, submit | Access **retained** — unticking never revokes |
| 2.6 | A user with no name set | Still listed, by email |
| 2.7 | Share a single **contact** from its page, as VIEW | B sees it |
| 2.8 | Share a single **event** from its page, as VIEW | B sees it |
| 2.9 | Blanket **All my contacts**, then A adds a new contact | B sees the new one too, without re-sharing |
| 2.10 | As B, on a VIEW-shared record | No Edit control |
| 2.11 | As B, type `/people/<id>/edit` directly for a VIEW record | Refused — not merely hidden |
| 2.12 | Re-share as EDIT; as B, edit and save | Saves; A sees the change |
| 2.13 | As B, on an EDIT-shared record | **No Delete control** — deleting is owner-only |
| 2.14 | As B, add an attendee to a shared event | Allowed |
| 2.15 | As B, add notes to a shared event | Allowed |
| 2.16 | A contact A has **not** shared: B's list, B's search, direct URL | Absent, absent, 404 |
| 2.17 | Shared records in B's lists | `shared` badge, tooltip naming A |
| 2.18 | Revoke as **owner** (A) | B loses access |
| 2.19 | Revoke as **recipient** (B) | B loses access — either side can withdraw |
| 2.20 | Single-user install (before B signs in) | Empty-state message, no Share button |

---

## 3 — One Hearth contact, every Google address book

The headline requirement, and the part that was structurally impossible before this
release. 3.11 is the subtle one: a contact reachable through *two* grants must
survive losing *one*.

| # | Test | Expected |
|---|---|---|
| 3.1 | A shares a contact with B, wait for sync | Contact appears in **B's Google Contacts** |
| 3.2 | Check A's Google Contacts | A's copy still there, unchanged |
| 3.3 | **B** edits the shared contact's phone in Hearth | **Both** A's and B's Google copies show the new number |
| 3.4 | A's mapped custom field, seen in B's Google copy | Rendered via **A's** label and mapping |
| 3.5 | Give B a custom field with the same key but a different mapping | B's mapping does **not** alter the shared copy |
| 3.6 | Blanket-share all contacts with B | All of A's contacts land in B's Google |
| 3.7 | Revoke the share | Contact removed from **B's** Google; A's untouched |
| 3.8 | Re-share the same contact | **One** contact in B's Google, not two |
| 3.9 | A unticks **Add to Google** | Removed from **both** accounts |
| 3.10 | A deletes the contact | Removed from both accounts |
| 3.11 | Share a contact **individually and** by blanket grant, then revoke only the individual one | Contact **stays** in B's Google — still reachable |
| 3.12 | Revoke B's Google grant in B's Google account settings, edit the contact | A's copy still syncs; B's shows `Error`, A's does not |
| 3.13 | Sync badge on a shared contact, viewed as A vs as B | Independent per account |
| 3.14 | Untick **Add to Google**, then re-tick before the next sync cycle | No delete, no duplicate — the queued removal is cancelled |

### 3b — Declining shared contacts

As **B**, in **Settings → Contact sync**, the **Also push contacts shared with me**
toggle. On by default.

| # | Test | Expected |
|---|---|---|
| 3b.1 | Untick it and save | Shared contacts **leave B's Google** within a sync cycle |
| 3b.2 | B's **own** contacts | Untouched in B's Google |
| 3b.3 | A's Google | Untouched — B's choice is B's alone |
| 3b.4 | The shared contact in B's Hearth | Still listed, still editable if EDIT — this removes the Google copy, not the access |
| 3b.5 | Wait two more sync cycles | Not silently re-added |
| 3b.6 | Re-tick and save | Reappears in B's Google, exactly once |
| 3b.7 | Untick, save, re-tick, save again within one cycle | Exactly one copy — no duplicate, no stranded entry |

---

## 4 — M3 regressions

Sharing touched the access layer that events also read through, and attendee
handling is where a Google patch resets RSVPs. Re-run these even though they passed
in 0.3.0.

| # | Test | Expected |
|---|---|---|
| 4.1 | Sharing an **event** with B | Does **not** land on B's calendar merely from sharing |
| 4.2 | New event | **Send to Google Calendar** unticked by default |
| 4.3 | Tick it, add an attendee whose contact has a real email | Event created; **invite email actually arrives** |
| 4.4 | Attendee accepts in Google | RSVP appears in Hearth |
| 4.5 | Edit the event, save, re-check RSVPs | Accepted status **survives** the patch |
| 4.6 | All-day event spanning Mon–Wed | Google shows Mon–Wed, not Mon–Tue |
| 4.7 | "Open in Google Calendar" | Opens the right event, no 500 |
| 4.8 | Location field on the event view | Appears **once** |
| 4.9 | Location input | Searches places, fills the address on select |
| 4.10 | "Add someone" on an event | Type-ahead, wildcard both ends |
| 4.11 | Untick **Send to Google Calendar** on a synced event | Removed from the calendar |

---

## 5 — Operational

| # | Test | Expected |
|---|---|---|
| 5.1 | Restart the container mid-sync | Lease released, sync resumes, nothing duplicated |
| 5.2 | Two sync cycles with nothing changed | No writes to Google — idempotent |
| 5.3 | `docker compose logs` after an hour | No repeating errors, no runaway retries |
| 5.4 | B signs out and back in | No duplicate user, no re-adoption of contacts |
| 5.5 | Backup restore rehearsal (`pg_dump` from `update-hearth.sh`) | Restores and boots |

---

## Recording the result

0.4.0 ships when §0–§3b pass in full and §4 shows no regression. §5.5 can trail.

§3b and tests 3.8, 3.11 and 3.15 are also covered by an automated run against a real
Postgres with per-account fake address books — the manual pass is confirming that
Google behaves as the fake does.

Anything that fails in §0 is a **stop** — a mis-migration silently duplicates every
contact in every account, and each hour of running makes it harder to unpick.
