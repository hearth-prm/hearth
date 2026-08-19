import type { ContactKind } from "@prisma/client";

/**
 * Snapshotting a contact, and describing what changed between two snapshots.
 *
 * Pure — no database, no network, no clock — for the same reason serialize-person.ts is.
 * The snapshot is what history remembers and the diff is what a person reads; both are
 * worth testing exhaustively without a database behind them.
 *
 * The diff is DERIVED rather than stored. Two snapshots are enough to say what changed, so
 * there is no second representation to keep in step — and improving how a change is worded
 * improves it for every version already recorded, not only for new ones.
 */

export interface SnapshotContactPoint {
  kind: ContactKind;
  label: string | null;
  value: string;
  detail: Record<string, string | null>;
}

export interface PersonSnapshot {
  /** Core and Google columns, by column name. */
  fields: Record<string, string | null>;
  contactPoints: SnapshotContactPoint[];
  labels: string[];
  custom: Record<string, string | null>;
  events: { label: string | null; year: number | null; month: number; day: number }[];
  relations: { name: string; label: string | null }[];
  /** Who owned it. A transfer is a change worth seeing in the history. */
  ownerEmail: string | null;
  /**
   * Present only while the contact is in the trash.
   *
   * In the snapshot because a version is recorded only when the content differs from the
   * last one, and trashing changes nothing else a snapshot holds — so without this,
   * moving a contact to the trash left no trace in its own history.
   *
   * Optional rather than a boolean that is usually false, so snapshots taken before this
   * existed still compare equal to new ones and no install gains a version saying
   * nothing happened.
   */
  trashed?: true;
}

/** Columns worth remembering. Sync state and timestamps are deliberately absent. */
export const SNAPSHOT_FIELDS = [
  "givenName",
  "middleName",
  "familyName",
  "honorificPrefix",
  "honorificSuffix",
  "phoneticGivenName",
  "phoneticMiddleName",
  "phoneticFamilyName",
  "nickname",
  "organization",
  "jobTitle",
  "orgDepartment",
  "orgJobDescription",
  "orgSymbol",
  "orgDomain",
  "orgLocation",
  "orgPhoneticName",
  "orgType",
  "gender",
  "birthday",
  "birthdayText",
  "notes",
] as const;

const DETAIL_KEYS = [
  "poBox",
  "streetAddress",
  "extendedAddress",
  "city",
  "region",
  "postalCode",
  "country",
  "countryCode",
  "displayName",
  "protocol",
  "buildingId",
  "floor",
  "floorSection",
  "deskCode",
] as const;

type Rowish = Record<string, unknown>;

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

export interface SnapshotInput {
  person: Rowish;
  contactPoints: readonly Rowish[];
  labels: readonly string[];
  events: readonly Rowish[];
  relations: readonly Rowish[];
  ownerEmail: string | null;
}

/**
 * Take the snapshot.
 *
 * Everything repeated is sorted, so rows coming back in a different order is not mistaken
 * for a change somebody made. Sync columns, timestamps and ids are left out for the same
 * reason: a push to Google must not look like an edit.
 */
export function snapshotPerson(input: SnapshotInput): PersonSnapshot {
  const fields: Record<string, string | null> = {};
  for (const key of SNAPSHOT_FIELDS) fields[key] = text(input.person[key]);

  const contactPoints = input.contactPoints
    .map((cp) => ({
      kind: cp.kind as ContactKind,
      label: text(cp.label),
      value: text(cp.value) ?? "",
      detail: Object.fromEntries(
        DETAIL_KEYS.map((k) => [k, text(cp[k])]).filter(([, v]) => v !== null),
      ) as Record<string, string | null>,
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));

  const custom: Record<string, string | null> = {};
  const bag = (input.person.custom ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(bag).sort()) custom[key] = text(bag[key]);

  return {
    fields,
    contactPoints,
    labels: [...input.labels].sort(),
    custom,
    events: input.events
      .map((e) => ({
        label: text(e.label),
        year: typeof e.year === "number" ? e.year : null,
        month: Number(e.month),
        day: Number(e.day),
      }))
      .sort((a, b) => a.month - b.month || a.day - b.day),
    relations: input.relations
      .map((r) => ({ name: text(r.name) ?? "", label: text(r.label) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    ownerEmail: input.ownerEmail,
    ...(input.person.deletedAt ? { trashed: true as const } : {}),
  };
}

export interface FieldChange {
  /** What changed, in words a person reads rather than a column name. */
  what: string;
  from: string | null;
  to: string | null;
}

export const SNAPSHOT_FIELD_LABELS: Record<string, string> = {
  givenName: "First name",
  middleName: "Middle name",
  familyName: "Last name",
  honorificPrefix: "Title",
  honorificSuffix: "Suffix",
  phoneticGivenName: "First name (phonetic)",
  phoneticMiddleName: "Middle name (phonetic)",
  phoneticFamilyName: "Last name (phonetic)",
  nickname: "Nickname",
  organization: "Organisation",
  jobTitle: "Job title",
  orgDepartment: "Department",
  orgJobDescription: "Job description",
  orgSymbol: "Ticker symbol",
  orgDomain: "Organisation domain",
  orgLocation: "Office",
  orgPhoneticName: "Organisation (phonetic)",
  orgType: "Organisation type",
  gender: "Gender",
  birthday: "Birthday",
  birthdayText: "Birthday (no year)",
  notes: "Notes",
};

const KIND_WORDS: Record<string, string> = {
  EMAIL: "Email",
  PHONE: "Phone",
  URL: "Link",
  ADDRESS: "Address",
  SOCIAL: "Social",
  IM: "Chat",
  SIP: "SIP",
  CALENDAR: "Calendar",
  EXTERNAL_ID: "External id",
  KEYWORD: "Keyword",
  INTEREST: "Interest",
  SKILL: "Skill",
  OCCUPATION: "Occupation",
  LOCATION: "Location",
  NICKNAME: "Other nickname",
};

function kindWord(kind: ContactKind): string {
  return KIND_WORDS[kind] ?? kind;
}

function pointLabel(cp: SnapshotContactPoint): string {
  return cp.label ? `${kindWord(cp.kind)} (${cp.label})` : kindWord(cp.kind);
}

function describePoint(cp: SnapshotContactPoint): string {
  const parts = Object.values(cp.detail).filter((v): v is string => Boolean(v));
  return parts.length > 0 ? `${cp.value} [${parts.join(", ")}]` : cp.value;
}

/** Same kind, same label, same value: the identity of a contact point. */
function pointKey(cp: SnapshotContactPoint): string {
  return `${cp.kind}|${cp.label ?? ""}|${cp.value}`;
}

/**
 * What changed between two snapshots.
 *
 * An added or removed entry is one change with the other side null, rather than a pair:
 * adding an email is one event and reads as one.
 */
export function diffSnapshots(
  before: PersonSnapshot | null,
  after: PersonSnapshot,
): FieldChange[] {
  const changes: FieldChange[] = [];

  // A first version has nothing to compare against, and listing every field as added
  // would say only that the contact was created — which the source already says.
  if (!before) return changes;

  for (const key of SNAPSHOT_FIELDS) {
    const from = before.fields[key] ?? null;
    const to = after.fields[key] ?? null;
    if (from !== to) changes.push({ what: SNAPSHOT_FIELD_LABELS[key] ?? key, from, to });
  }

  const wasPoints = new Map(before.contactPoints.map((cp) => [pointKey(cp), cp]));
  const nowPoints = new Map(after.contactPoints.map((cp) => [pointKey(cp), cp]));
  for (const [key, cp] of nowPoints) {
    const was = wasPoints.get(key);
    if (!was) {
      changes.push({ what: pointLabel(cp), from: null, to: describePoint(cp) });
    } else if (describePoint(was) !== describePoint(cp)) {
      // Same kind, label and value, so only the structured detail moved.
      changes.push({
        what: pointLabel(cp),
        from: describePoint(was),
        to: describePoint(cp),
      });
    }
  }
  for (const [key, cp] of wasPoints) {
    if (!nowPoints.has(key)) {
      changes.push({ what: pointLabel(cp), from: describePoint(cp), to: null });
    }
  }

  for (const name of after.labels) {
    if (!before.labels.includes(name)) {
      changes.push({ what: "Label", from: null, to: name });
    }
  }
  for (const name of before.labels) {
    if (!after.labels.includes(name)) {
      changes.push({ what: "Label", from: name, to: null });
    }
  }

  for (const key of [
    ...new Set([...Object.keys(before.custom), ...Object.keys(after.custom)]),
  ].sort()) {
    const from = before.custom[key] ?? null;
    const to = after.custom[key] ?? null;
    if (from !== to) changes.push({ what: key, from, to });
  }

  const eventText = (e: PersonSnapshot["events"][number]) =>
    `${e.label ?? "Date"}: ${e.year ? `${e.year}-` : ""}${e.month}/${e.day}`;
  for (const e of after.events) {
    if (!before.events.some((b) => eventText(b) === eventText(e))) {
      changes.push({ what: "Date", from: null, to: eventText(e) });
    }
  }
  for (const e of before.events) {
    if (!after.events.some((a) => eventText(a) === eventText(e))) {
      changes.push({ what: "Date", from: eventText(e), to: null });
    }
  }

  const relText = (r: PersonSnapshot["relations"][number]) =>
    r.label ? `${r.label}: ${r.name}` : r.name;
  for (const r of after.relations) {
    if (!before.relations.some((b) => relText(b) === relText(r))) {
      changes.push({ what: "Named in Google", from: null, to: relText(r) });
    }
  }
  for (const r of before.relations) {
    if (!after.relations.some((a) => relText(a) === relText(r))) {
      changes.push({ what: "Named in Google", from: relText(r), to: null });
    }
  }

  if (before.ownerEmail !== after.ownerEmail) {
    changes.push({ what: "Owner", from: before.ownerEmail, to: after.ownerEmail });
  }

  // Said in the diff as well as in the source word, so an entry for a trashing is not an
  // otherwise-empty version reading "no visible change".
  if (Boolean(before.trashed) !== Boolean(after.trashed)) {
    changes.push({
      what: "In the trash",
      from: before.trashed ? "yes" : null,
      to: after.trashed ? "yes" : null,
    });
  }

  return changes;
}

/**
 * Order-independent JSON, for comparing a snapshot with one that has been stored.
 *
 * Postgres `jsonb` does not preserve key order — it normalises on the way in — so a
 * snapshot read back from the database has its keys in a different order from the one just
 * built in memory. Comparing JSON.stringify output therefore reported every single
 * read-back as a change, which meant a sync touching updatedAt recorded a version saying
 * nothing had happened. Sorting keys on both sides is what makes the comparison about the
 * content rather than about how Postgres chose to store it.
 *
 * Arrays keep their order, which is deliberate: snapshotPerson has already sorted them, so
 * a difference in array order at this point is a real difference.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** True when two snapshots say the same thing, so nothing need be recorded. */
export function sameSnapshot(a: PersonSnapshot | null, b: PersonSnapshot): boolean {
  if (a === null) return false;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
