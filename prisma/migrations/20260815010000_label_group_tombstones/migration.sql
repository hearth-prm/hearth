-- Lets a deleted label take its Google contact group with it.
--
-- Without this, deleting a Hearth label left the Google label in place on every
-- phone it had reached: the LabelGroup rows cascade away with the label, so the
-- sync engine loses the only handle it had on the remote group. Same reasoning as
-- SyncTombstone itself, one level up — the thing that knows the remote id is about
-- to be deleted, so the id has to be recorded first.
--
-- ALTER TYPE ... ADD VALUE is additive and safe inside a transaction on Postgres 12
-- and later, provided the new value is not also *used* in the same transaction.
-- Nothing here writes a row, so that holds.

ALTER TYPE "SyncTarget" ADD VALUE 'GOOGLE_CONTACT_GROUP';
