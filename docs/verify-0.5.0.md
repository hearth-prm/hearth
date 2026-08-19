# Verifying 0.5.0 (M5 — labels, filtering, CSV import/export)

Run [verify-0.4.0.md](verify-0.4.0.md) **first**. M5 changes the contact sync engine,
so a failure there is much easier to diagnose against a sharing setup already known
to work.

## Most of this is automated

    npm run e2e

That builds the app, starts a real Postgres 16 and a real browser, and works through
**§1, §2, §4–§8 and the non-Google half of §9** — 140 checks. It needs no Google
account, because sign-in is bypassed by inserting a session row directly.

    npm run e2e:google

That covers **§3 in full**, plus 6.5, 7.20, 9.3, 9.4, 9.7 and photo sync — 54 checks
against two real Google accounts, driving Hearth's own sync engine and then asking Google what
happened. It needs `.env.e2e`; see `npm run token`. It is **destructive** to those
accounts and refuses to run against one holding enough contacts to look real.

Between them, 235 checks. Rows they cover are marked **⚙**. What is left is **§0** —
whether *your* data survived the upgrade, which nothing can stand in for — and three
rows needing a mailbox, a container or an hour.

## Setup

| | |
|---|---|
| **A** | you — owner of the records under test |
| **B** | second Google account (your wife), a separate Hearth user |

- Both signed in, both with contacts scope granted.
- **Google Contacts open for both accounts, in separate browser profiles.** Two tabs
  in one profile shows you the same account twice, which would make all of §3 pass
  while nothing reached B.
- Have a spreadsheet program to hand — Excel, LibreOffice or Google Sheets. §5 and §6
  are partly about whether the file survives one.
- Sync is not instant. Google has taken minutes to reflect a write on this install.
  Re-check after five minutes before recording a failure.

### One thing to do before you start

**In B's Google Contacts, create a label called `Neighbours` by hand.** Test 3.9 needs
it to exist before Hearth knows about it. Do it now, because it cannot be
retro-fitted once Hearth has created its own.

---

## 0 — Upgrade safety

Both migrations are additive — three new tables and one enum value, nothing altered
or dropped. §0 is short for that reason, but 0.3 is still the one to run first.

| # | Test | Expected |
|---|---|---|
| 0.1 | Update, watch the container logs | Both migrations apply, no error |
| 0.2 | Footer / Settings version | Reports the new build |
| 0.3 | Google Contacts for A, after a sync cycle | **No duplicates, no new labels.** A contact with no Hearth labels must not acquire any group |
| 0.4 | Existing contacts in Hearth | Still `Synced`, not reset to `Pending` |
| 0.5 | Existing shares, mappings and custom fields | All still in place |

---

## 1 — Labels in Hearth

| # | Test | Expected |
|---|---|---|
| ⚙ 1.1 | **Settings → Labels** | New tab exists and loads |
| ⚙ 1.2 | Add a label `Family` | Appears as a chip; a colour is chosen automatically |
| ⚙ 1.3 | Add `Book club`, `Work`, `VIP` | All appear, sorted by name |
| ⚙ 1.4 | Type a name and watch before submitting | Live chip preview |
| ⚙ 1.5 | Pick an explicit colour, save | Chip uses it |
| ⚙ 1.6 | Try adding `family` (lower case) | Refused — *you already have a "Family" label* |
| ⚙ 1.7 | Try adding `Book  club` (two spaces) | Refused as a duplicate; whitespace collapses |
| ⚙ 1.8 | Add a label with a blank name | Refused |
| ⚙ 1.9 | Rename `Work` → `Colleagues` | Saves; chip updates everywhere |
| ⚙ 1.10 | Rename `VIP` → `Family` | Refused — the name is taken |
| ⚙ 1.11 | Label list, before use | Each unused label says *not used yet* |
| ⚙ 1.12 | Delete an unused label | Gone, no confirmation drama |

---

## 2 — Labels on contacts

The rule under test: **a shared contact carries its owner's labels.** 2.6 and 2.7 are
the ones that prove it.

| # | Test | Expected |
|---|---|---|
| ⚙ 2.1 | Open a contact, **Labels** card | Present, says *No labels on this contact* |
| ⚙ 2.2 | Add `Family` and `VIP` | Both chips appear |
| ⚙ 2.3 | The People list | New **Labels** column shows both chips |
| ⚙ 2.4 | Click a chip anywhere | Jumps to the contact list filtered to that label |
| ⚙ 2.5 | Untick `VIP`, save | Removed — unticking a **label** does remove it, unlike sharing |
| ⚙ 2.6 | Share that contact with B as **EDIT**; as B, open it | Labels card shows **A's** labels, and says so |
| ⚙ 2.7 | As B, tick one of A's labels | Allowed — B is choosing from A's list, not creating their own |
| ⚙ 2.8 | As B, look for A's labels in B's **Settings → Labels** | **Absent.** A's labels are not B's to manage |
| ⚙ 2.9 | As B, on a **VIEW**-shared contact | Cannot change labels |
| ⚙ 2.10 | Settings → Labels as A | `Family` now reports its contact count, linked |

---

## 3 — Labels in Google Contacts

Covered by `npm run e2e:google` against two throwaway accounts — **all 15 rows pass**,
including the three stop conditions (3.2, 3.3, 3.11). Those were the ones that would
have damaged an address book rather than merely failing, and they confirm the design
bet: Hearth changes group membership through `contactGroups.members.modify` rather than
writing `memberships` on the contact, so a labelled contact stays in My Contacts and a
group you made by hand is left alone.

Re-run it by hand against your own accounts only if you want the reassurance; the
mechanism is proven.

| # | Test | Expected |
|---|---|---|
| ⚙ 3.1 | Label a contact `Family`, wait for sync, open **A's** Google Contacts | A `Family` label exists, with that contact in it |
| ⚙ 3.2 | That contact's presence in **My Contacts** | **Still there.** Applying a label must not move it out |
| ⚙ 3.3 | In Google, put a synced contact in a group Hearth has never heard of, then edit the contact in Hearth and re-sync | It is **still in your hand-made group**. Hearth only touches groups it created |
| ⚙ 3.4 | B's Google Contacts (contact shared with B) | B has their **own** `Family` label, containing it |
| ⚙ 3.5 | Compare the two labels | Same name, different underlying groups — each account has its own |
| ⚙ 3.6 | A label with no contacts on it | **No** Google group is created |
| ⚙ 3.7 | Remove `Family` from the contact in Hearth, re-sync | Gone from the Google label; the contact itself remains |
| ⚙ 3.8 | Rename `Family` → `Household` in Hearth, re-sync | The Google label is **renamed**, not duplicated |
| ⚙ 3.9 | Create a Hearth label `Neighbours` — the name you made by hand in B's Google — apply it to a shared contact, sync as B | Hearth **adopts** the existing Google label. Exactly one `Neighbours` in B's Google |
| ⚙ 3.10 | Delete the `Household` label in Hearth, re-sync | The Google label is **deleted** in every account it reached |
| ⚙ 3.11 | The contacts that were in it | **All still present** in Google. Only the grouping went |
| ⚙ 3.12 | Settings → Contact sync, last-sync summary | Mentions labels applied |
| ⚙ 3.13 | Revoke B's Google grant, label a shared contact, sync both | A's labels apply; B's account errors alone |
| ⚙ 3.14 | As B, untick **Also push contacts shared with me**, then label the shared contact as A | B's Google is untouched; A's still gets the label |
| ⚙ 3.15 | Apply five labels to one contact, sync | All five groups created, contact in all five |

---

## 4 — Filtering

Every filter is a link carrying the whole state, so 4.12–4.14 are as much part of the
feature as the filters themselves.

Set up: one contact with `Family`+`VIP`, one with `Family` only, one with no labels
and **Add to Google** off, and one of B's shared with A.

| # | Test | Expected |
|---|---|---|
| ⚙ 4.1 | No filters | Every contact you can read |
| ⚙ 4.2 | Click the `Family` label pill | Both `Family` contacts |
| ⚙ 4.3 | Also click `VIP` | Still both — *matching any* by default |
| ⚙ 4.4 | Click **matching any — switch to all** | Just the one with both |
| ⚙ 4.5 | **Who → Shared with me** | Only B's contact |
| ⚙ 4.6 | **Who → Shared by me** | Only what A has shared |
| ⚙ 4.7 | **Who → Mine, not shared** | A's contacts with nobody on them |
| ⚙ 4.8 | Share **all contacts** with B, then re-check *Mine, not shared* | **Empty** — a blanket grant counts, though it is not recorded per record |
| ⚙ 4.9 | **Google → Add to Google off** | Just that one contact |
| ⚙ 4.10 | **Google → Sync failed** | Only contacts erroring for **your** account |
| ⚙ 4.11 | **Details → No email** | Correct subset |
| ⚙ 4.12 | Type in the search box with filters already active | Filters **survive** the search |
| ⚙ 4.13 | Combine label + Who + Details | All three apply together; the count line updates |
| ⚙ 4.14 | Browser **Back** | Undoes one filter at a time |
| ⚙ 4.15 | Copy the URL into a new tab | Same filtered view |
| ⚙ 4.16 | **clear filters** | Back to everything |
| ⚙ 4.17 | Filter to something with no matches | *Nothing matches those filters*, with a clear-filters button |
| ⚙ 4.18 | Search for a label name in the text box | Finds that label's members |

---

## 5 — Export

| # | Test | Expected |
|---|---|---|
| ⚙ 5.1 | **Export all as CSV** at the bottom of an unfiltered list | Downloads `hearth-contacts-<date>.csv` |
| ⚙ 5.2 | Filter to `Family`, then export | Link reads *Export these as CSV*; file holds only those contacts |
| ⚙ 5.3 | Open the file in Excel or Sheets | Columns line up; **accented names are not mojibake** |
| ⚙ 5.4 | A contact with a comma in its notes | Stays in one cell |
| ⚙ 5.5 | A contact with a line break in its notes | Stays in one cell |
| ⚙ 5.6 | `Labels` column | `Family; VIP` |
| ⚙ 5.7 | `Emails` column for a contact with typed entries | `home\|a@b.com; work\|c@d.com` |
| ⚙ 5.8 | `URLs` column | The URL's own colons are intact |
| ⚙ 5.9 | `Shared with` column | `wife@example.com\|EDIT` |
| ⚙ 5.10 | `Shared via blanket grant` column | Lists recipients of an all-contacts grant |
| ⚙ 5.11 | Your custom fields | One column each, headed with the field's name |
| ⚙ 5.12 | `Hearth ID` column | Present and populated |
| ⚙ 5.13 | Export while viewing contacts shared **with** you | Included, with `Owner` showing whose they are |

---

## 6 — The round trip

The strongest single test in this document: a file Hearth wrote, fed straight back,
must be a no-op. It exercises the whole dialect against your real data rather than
against an example.

| # | Test | Expected |
|---|---|---|
| ⚙ 6.1 | Export everything, then import that file unchanged | Preview shows **zero creates**. Your own contacts update; any shared with you are skipped, since you cannot write them |
| ⚙ 6.2 | Confirm the import | Finishes without error |
| ⚙ 6.3 | Compare a few contacts before and after | **Nothing changed** — no lost phone numbers, labels or shares |
| ⚙ 6.4 | New labels reported by the preview | **None** — every label already existed |
| ⚙ 6.5 | Google Contacts after the next sync | No duplicates created |
| ⚙ 6.6 | Open the exported file in a spreadsheet, save it from there, re-import | Still a clean round trip |

---

## 7 — Import: matching and safety

| # | Test | Expected |
|---|---|---|
| ⚙ 7.1 | **Import** button on the People page → `/people/import` | Loads, with the format reference alongside |
| ⚙ 7.2 | A file with a new name and no `Hearth ID` | Previewed as **new** |
| ⚙ 7.3 | A row whose `Hearth ID` matches | Previewed as **update**, named correctly |
| ⚙ 7.4 | Drop the `Hearth ID` column, keep an email that matches | Matched by email, and the preview says so |
| ⚙ 7.5 | A completely blank row | **Skipped** — nothing to identify it by |
| ⚙ 7.6 | Two rows with the same `Hearth ID` | Second **skipped**, saying another row already updates it |
| ⚙ 7.7 | A column Hearth does not recognise | Listed as ignored, not silently dropped |
| ⚙ 7.8 | `Birthday` as `03/04/1990` | **Reported**, not guessed at, and left unchanged |
| ⚙ 7.9 | `Birthday` as `1990-04-03` | Applied |
| ⚙ 7.10 | A file with only `Hearth ID` and `Labels` | No contact details are touched, so nothing is warned about; after import, **phone numbers survive** |
| ⚙ 7.10b | A file with an `Emails` column but no `Phones` | Preview says phones are **kept**; after import they survive |
| ⚙ 7.11 | `Labels` cell naming a label that does not exist | Listed under *New labels*; created on import |
| ⚙ 7.12 | `Shared with` naming somebody who is not a Hearth user | Reported as not a user; import continues |
| ⚙ 7.13 | `Shared with` a real user, with `\|EDIT` | Share granted at EDIT |
| ⚙ 7.14 | **Remove** a recipient from the file, re-import | Their access **survives** — import grants only |
| ⚙ 7.15 | An invalid value in a custom field column | That field reported and left unchanged; the rest of the row applies |
| ⚙ 7.16 | Preview, then confirm | Applies the file you reviewed, without asking for it again |
| ⚙ 7.17 | Preview, then navigate away and come back | Preview is gone; nothing was written |
| ⚙ 7.18 | A file over 4 MB, or over 5,000 rows | Refused with a clear message, nothing half-applied |
| ⚙ 7.19 | A file with a header row and nothing else | Refused, saying so |
| ⚙ 7.20 | After import, Google Contacts | Imported contacts and their labels appear on the next sync |

---

## 8 — Import: permissions

Import must not become a way around the sharing rules. Every row here is a thing the
file asks for and must not get.

| # | Test | Expected |
|---|---|---|
| ⚙ 8.1 | As A, import a row whose `Hearth ID` is a contact B shared as **EDIT** | Updates it — a legitimate edit |
| ⚙ 8.2 | Same row with a `Labels` cell | **Refused**, saying labels belong to the owner |
| ⚙ 8.3 | Same row with a `Shared with` cell | **Refused**, saying only the owner can share |
| ⚙ 8.4 | Same row with a custom field column | **Refused**, saying custom fields are keyed by the owner's definitions |
| ⚙ 8.5 | A row whose `Hearth ID` is a contact B has **not** shared | Does **not** touch it, and does **not** duplicate it — the row is **skipped** with a warning |
| ⚙ 8.6 | A row matching a **shared** contact only by email | Becomes a **new** contact. An email match never reaches someone else's record |
| ⚙ 8.7 | A row with an `Owner` column naming B | Ignored — ownership is not importable |
| ⚙ 8.8 | As B afterwards, check the contact A tried to relabel | Unchanged |

---

## 9 — Regressions

M5 touched the sync engine, the access layer's writable guard, and the shared field
validator. These are the things that could have been broken from a distance.

| # | Test | Expected |
|---|---|---|
| ⚙ 9.1 | Edit a contact through the normal form | Saves; custom fields and dates still correct |
| ⚙ 9.2 | Edit a contact shared with you as EDIT | Saves, using the owner's field definitions |
| ⚙ 9.3 | Untick **Add to Google** on a labelled contact | Removed from Google, from its labels too |
| ⚙ 9.4 | Delete a labelled contact | Removed from Google; the label itself survives |
| ⚙ 9.5 | Field mapping pages | Still work; a custom field still lands where mapped |
| 9.6 | Create and edit an event, with a guest | Unaffected — invite still sent, RSVP still returns |
| ⚙ 9.7 | Two sync cycles with nothing changed | No writes to Google, no group churn |
| 9.8 | Container restart mid-sync | Resumes; no duplicate contacts or groups |
| 9.9 | `docker compose logs` after an hour | No repeating errors |

---

## What stays manual

Everything below needs your live install, a mailbox, a container, or an hour.

| Rows | Why |
|---|---|
| **§0** (all 5) | About *your* data surviving the upgrade — no test can stand in for it |
| 9.6 | Whether the invite **email** arrives. `e2e:google` can prove Google accepted the invite; an inbox needs Gmail scope or your eyes |
| 9.8 | Container restart — needs Docker, which the test environment does not have |
| 9.9 | An hour of logs |

That is **8 rows** by hand, against 415 automated checks.

Run both suites first. If either fails, the manual pass is not worth starting.

## Recording the result

`v0.5.0` ships when both suites pass and the 8 manual rows show no regression. Since M4 is still
unverified, cut **both** tags once each checklist passes — `v0.4.0` first, so the
history reads in milestone order.

Anything failing in §3.2, §3.3 or §3.11 is a **stop**: those three are the ones where
a wrong assumption about Google's group API damages an address book rather than merely
failing. Turn labels off in practice — delete the Hearth labels — and report it before
running another sync.
