# Design: sticky shares on a label

Status: **built.** Amended in three places while building; see the end.

## What it is

A label carries standing sharing intentions. Put a contact in *Family_Hammerling* and it is
shared with Karen who may edit and Kenny who may view, without anyone visiting the sharing
controls. Take it out and those shares go, unless something else still implies them.

The point is that filing a contact is the thing people actually do. Sharing is the thing they
forget, and a share nobody remembered to grant is indistinguishable from a decision not to.

## Model

```
LabelShare {
  labelId       String
  withUserId    String
  permission    VIEW | EDIT
  @@unique([labelId, withUserId])
}
```

Owned implicitly by the label's owner — sharing is owner-only, and a label already belongs to
one person.

And one column on the existing table:

```
Share.viaLabelId  String?     // null for a share somebody granted by hand
```

That column is the whole design. Without provenance there is no way to tell a share the rule
created from one a person created, and therefore no safe way to withdraw anything.

## Reconcile, do not react

There are at least five paths that put a label on a contact: the label picker on a contact
page, bulk labelling from the people list, CSV import, the in-place Google import turning
groups into labels, and creating a contact with labels already chosen. A rule applied at each
of those is a rule applied at four of them by next spring.

So the shape is one function, called by all of them:

```
reconcilePersonShares(tx, personId)
```

It computes the shares the contact's labels currently imply, and makes the rows match. It only
ever creates, updates or deletes rows where `viaLabelId` is set. A hand-made share is not its
business.

This is the same choice [`reconcileCardShares`](../src/lib/household.ts) already makes for
household cards, and for the same stated reason: *"make the graph correct" rather than "add the
rows this event implies"* — the second form has to be right about every event, the first is
simply idempotent.

The mirror function handles the other direction:

```
reconcileLabelShares(tx, labelId)     // after the rule itself changes
```

Adding Kenny to a label's rules must reach the seventeen contacts already filed under it, not
only the eighteenth.

## The decisions worth writing down

**Two labels, two permissions.** A contact in a label granting Karen VIEW and another granting
Karen EDIT ends up with EDIT. The highest permission implied wins; anything else would make the
result depend on the order the labels were added.

**A rule never lowers a hand-made share.** If Karen has EDIT granted directly and a sticky rule
says VIEW, she keeps EDIT. Manual shares are outside the reconciliation entirely — they are
neither raised, lowered, nor removed by it.

**Leaving one label of two changes nothing** if the other still implies the same share. That is
why this is a recomputation and not a delete-by-provenance: the naive version revokes Karen's
access because *a* label was removed, while a second label still says she should have it.

**The Google consequence is stated before it happens.** A share means the contact reaches that
person's Google Contacts, and withdrawing one removes it again — so adding a rule to a label
with seventeen members pushes seventeen contacts into somebody else's address book. The rule
editor says how many contacts it will affect and that they will appear in the recipient's
Google, in the same spirit as the bulk sharing panel.

**Somebody else's edit can trigger your rule.** A user with EDIT on your contact can add your
label to it, which fires your sticky rule and creates shares owned by you. That is the correct
outcome — the rule is your standing intention about your contact — but it is surprising enough
to belong in the docs and in the label editor's help text.

**Trashed contacts are skipped.** Their shares are already dormant; restoring one runs
reconciliation again, which is the natural place for it.

## Where it appears

**Settings → Labels**, on each label: a list of users with a permission each, exactly the shape
of the bulk sharing panel. Plus the count of affected contacts and the Google warning.

Worth showing on a contact's own sharing card too: a share that came from a label should say so
rather than looking hand-made, otherwise the first thing anyone does is try to revoke it and
watch it come back.

## Testing

- Adding a label to a contact creates the implied shares; removing it removes them.
- A contact in two labels implying the same recipient keeps the share when one is removed.
- Conflicting permissions resolve to the higher one, whichever order the labels arrive in.
- A hand-made share is never removed, lowered or raised by reconciliation.
- Changing a label's rules reaches the contacts already in it.
- Every one of the five labelling paths ends up with the same shares — the check that makes the
  single-function design worth having, and the one that would fail if a sixth path is added
  later without calling it.
- The recipient can actually see the contact afterwards, and cannot once it is withdrawn: a row
  count is not the assertion that matters.

## Amended while building

**The participant set is symmetric, and that was the point of the feature after all.** The
design above only had the label's owner sharing outward. What was actually wanted is a shared
filing cabinet: anybody in the label can file their own contacts under it, and those contacts
are shared with everybody else in it — the owner included. So `LabelShare` is read as "what
this person receives, whoever filed the contact", the owner may have a row of her own (and
needs one to receive anything), and reconciliation is one rule for both directions: *share from
the contact's owner to every other participant*. Two rules — one out, one back — would have
needed a decision at every call site about which applied.

Three consequences fell out of that:

- A sticky label has to be **visible to participants**, so three read sites widened from
  "labels I own" to `usableLabelsWhere`. The Google layer needed nothing: `LabelGroup` already
  carried `@@unique([labelId, userId])` and the comment *"not necessarily the label's owner"*,
  because Google groups are per-account.
- `setPersonLabels` keys the allowed labels on the **contact's owner**, not the actor. That
  keeps "one contact, one set of labels" true, and it also means a recipient with EDIT can file
  the contact under its owner's labels — unchanged — but cannot drag it into a sharing circle of
  their own, because a label they are in and the owner is not does not apply there.
- **Only the owner edits the set.** A participant who could would be able to add somebody and
  expose the owner's contacts to them. Participants see it, since they are consenting to it.

**A hand-made share and a rule-made one coexist as two rows**, rather than the rule standing
aside. Better than what this document originally proposed, for a reason worth stating: every
access clause tests shares with `some`, so a manual VIEW beside a rule-made EDIT is simply
EDIT — permissions are additive with **no merge logic anywhere**. The rule never raises,
lowers or removes what a person granted, and nothing has to explain a silent no-op. The cost
is that the sharing UI groups by recipient instead of listing rows, which it should have done
anyway: two × buttons for one person, only one of which works, is worse than the grouping.

**Ownership transfer converts sticky shares to manual** rather than revoking them. Transfer
already deletes the contact's labels and deliberately keeps its shares so nobody silently loses
access; a strict reconcile would have revoked exactly the access that promise protects.
Clearing `viaLabelId` says the truth — granted by a rule that no longer applies, now a standing
grant to maintain by hand.
