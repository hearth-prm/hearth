import type { ContactKind, SharePermission } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writablePeopleWhere } from "@/lib/access";
import { loadRegistry } from "@/lib/fields/registry";
import { parseOneField, type FieldValues } from "@/lib/fields/validation";
import { partitionFieldValues } from "@/lib/fields/values";
import { getUserSettings } from "@/lib/settings";
import type { FieldDef } from "@/lib/fields/types";
import { computeDisplayName } from "@/lib/people";
import { labelKey, normaliseLabelName } from "@/lib/labels";
import { parseCsv, rowReader } from "@/lib/csv";
import {
  COLUMNS,
  CONTACT_KIND_COLUMN,
  csvRawValue,
  parseContactPoints,
  parseLabelList,
  parseShares,
  type CsvContactPoint,
} from "@/lib/contacts-csv";

/**
 * CSV import planning.
 *
 * The planner is the whole of import: it decides every change, and the apply step
 * only executes what it produced. Preview and apply therefore call the *same*
 * function, which is the only way the confirmation screen can be trusted — a
 * separate "what would happen" implementation drifts from the real one, and the
 * screen that says "3 updates" is exactly where that must never happen.
 *
 * Re-planning at apply time also re-checks access. The interval between preview and
 * confirmation is long enough for a share to be revoked.
 */

export type RowAction = "create" | "update" | "skip";

export interface PlannedRow {
  /** 1-based line in the file, counting the header — what a spreadsheet shows. */
  line: number;
  action: RowAction;
  personId: string | null;
  displayName: string;
  /** Human-readable summary of what will change. */
  changes: string[];
  /** Reasons a row is partly or wholly ignored. */
  warnings: string[];
  /** Null for a skipped row. */
  write: RowWrite | null;
}

export interface RowWrite {
  personId: string | null;
  ownerId: string;
  columns: Record<string, unknown>;
  custom: Record<string, unknown>;
  contactPoints: CsvContactPoint[] | null;
  /** Null means the file said nothing about labels, so leave them alone. */
  labelNames: string[] | null;
  shares: { userId: string; permission: SharePermission }[];
  addToGoogle: boolean | null;
}

export interface ImportPlan {
  headers: string[];
  /** Columns Hearth does not recognise, reported rather than silently dropped. */
  unknownHeaders: string[];
  rows: PlannedRow[];
  counts: { create: number; update: number; skip: number; warnings: number };
  /** Labels that do not exist yet and will be created. */
  newLabels: string[];
  /** Share targets that are not users of this install. */
  unknownShareEmails: string[];
  /** Fatal problem with the file itself; rows will be empty. */
  fatal: string | null;
}

const CORE_TEXT_COLUMNS = [
  ["givenName", COLUMNS.givenName],
  ["middleName", COLUMNS.middleName],
  ["familyName", COLUMNS.familyName],
  ["honorificPrefix", COLUMNS.honorificPrefix],
  ["honorificSuffix", COLUMNS.honorificSuffix],
  ["phoneticGivenName", COLUMNS.phoneticGivenName],
  ["phoneticMiddleName", COLUMNS.phoneticMiddleName],
  ["phoneticFamilyName", COLUMNS.phoneticFamilyName],
  ["nickname", COLUMNS.nickname],
  ["organization", COLUMNS.organization],
  ["jobTitle", COLUMNS.jobTitle],
  ["orgDepartment", COLUMNS.orgDepartment],
  ["orgJobDescription", COLUMNS.orgJobDescription],
  ["orgSymbol", COLUMNS.orgSymbol],
  ["orgDomain", COLUMNS.orgDomain],
  ["orgLocation", COLUMNS.orgLocation],
  ["orgPhoneticName", COLUMNS.orgPhoneticName],
  ["orgType", COLUMNS.orgType],
  ["gender", COLUMNS.gender],
  ["birthdayText", COLUMNS.birthdayText],
  ["notes", COLUMNS.notes],
] as const;

const KINDS = Object.keys(CONTACT_KIND_COLUMN) as ContactKind[];

/** Rows above this are refused outright rather than half-applied. */
export const MAX_IMPORT_ROWS = 5_000;

export async function planImport(
  userId: string,
  csvText: string,
): Promise<ImportPlan> {
  const empty = (fatal: string): ImportPlan => ({
    headers: [],
    unknownHeaders: [],
    rows: [],
    counts: { create: 0, update: 0, skip: 0, warnings: 0 },
    newLabels: [],
    unknownShareEmails: [],
    fatal,
  });

  const { headers, rows } = parseCsv(csvText);
  if (headers.length === 0) return empty("That file has no header row.");
  if (rows.length === 0) return empty("That file has a header row but no contacts.");
  if (rows.length > MAX_IMPORT_ROWS) {
    return empty(
      `That file has ${rows.length.toLocaleString()} rows; the limit is ${MAX_IMPORT_ROWS.toLocaleString()}. Split it and import in parts.`,
    );
  }

  const read = rowReader(headers);
  const [defs, settings] = await Promise.all([
    loadRegistry(userId, "PERSON"),
    getUserSettings(userId),
  ]);
  // Only matters for a custom DATETIME column, where a bare wall-clock time has to
  // be anchored to a zone before it can be stored.
  const timeZone = settings.timeZone;
  const customDefs = defs.filter((d) => !d.core);

  // Custom columns are matched by label, then by key: the label is what export
  // writes and what a user recognises, but a hand-made file may well use the key.
  const customByHeader = new Map<string, FieldDef>();
  for (const def of customDefs) {
    if (read.has(def.label)) customByHeader.set(def.label, def);
    else if (read.has(def.key)) customByHeader.set(def.key, def);
  }

  const known = [
    ...Object.values(COLUMNS),
    ...[...customByHeader.keys()],
  ];
  const unknownHeaders = read.unknown(known);

  // --- resolve everything the rows refer to, in as few queries as possible -----

  const idsInFile = rows.map((r) => read.get(r, COLUMNS.id)).filter(Boolean);
  const emailsInFile = rows.flatMap((r) =>
    parseContactPoints(read.get(r, COLUMNS.emails), "EMAIL").map((c) =>
      c.value.toLowerCase(),
    ),
  );
  const shareEmails = [
    ...new Set(rows.flatMap((r) => parseShares(read.get(r, COLUMNS.sharedWith)).map((s) => s.email))),
  ];

  const [byId, idsThatExist, byEmail, recipients, existingLabels] = await Promise.all([
    idsInFile.length
      ? prisma.person.findMany({
          where: { id: { in: [...new Set(idsInFile)] }, ...writablePeopleWhere(userId) },
          select: { id: true, ownerId: true, displayName: true },
        })
      : Promise.resolve([]),
    // Which of those ids exist at all, regardless of access. Needed to tell "a
    // record you may not edit" from "an id from somewhere else": the first must be
    // skipped, because a row naming a record is a request to update THAT record and
    // turning it into a new contact silently duplicates someone else's. Only the id
    // is selected, so this answers the question without revealing anything.
    idsInFile.length
      ? prisma.person.findMany({
          where: { id: { in: [...new Set(idsInFile)] } },
          select: { id: true },
        })
      : Promise.resolve([]),
    // Email matching is restricted to the user's OWN contacts. Matching by id is an
    // explicit instruction; matching by email is a guess, and a guess should not
    // reach into someone else's record even when sharing would permit the write.
    emailsInFile.length
      ? prisma.person.findMany({
          where: {
            ownerId: userId,
            contactPoints: { some: { kind: "EMAIL", value: { in: [...new Set(emailsInFile)], mode: "insensitive" } } },
          },
          select: {
            id: true,
            ownerId: true,
            displayName: true,
            contactPoints: { where: { kind: "EMAIL" }, select: { value: true } },
          },
        })
      : Promise.resolve([]),
    shareEmails.length
      ? prisma.user.findMany({
          where: { email: { in: shareEmails, mode: "insensitive" } },
          select: { id: true, email: true },
        })
      : Promise.resolve([]),
    prisma.label.findMany({ where: { ownerId: userId }, select: { name: true } }),
  ]);

  const idIndex = new Map(byId.map((p) => [p.id, p]));
  const existsAnywhere = new Set(idsThatExist.map((p) => p.id));
  const emailIndex = new Map<string, (typeof byEmail)[number]>();
  for (const p of byEmail) {
    for (const cp of p.contactPoints) {
      const key = cp.value.toLowerCase();
      if (!emailIndex.has(key)) emailIndex.set(key, p);
    }
  }
  const userIndex = new Map(
    recipients.flatMap((u) => (u.email ? [[u.email.toLowerCase(), u.id]] : [])),
  );
  const labelIndex = new Set(existingLabels.map((l) => labelKey(l.name)));

  const unknownShareEmails = shareEmails.filter((e) => !userIndex.has(e));
  const newLabels: string[] = [];
  const newLabelKeys = new Set<string>();

  // --- plan each row ----------------------------------------------------------

  const planned: PlannedRow[] = [];
  const seenIds = new Set<string>();

  rows.forEach((row, i) => {
    const line = i + 2; // +1 for zero-index, +1 for the header row
    const warnings: string[] = [];
    const changes: string[] = [];

    const rawId = read.get(row, COLUMNS.id);
    const emails = parseContactPoints(read.get(row, COLUMNS.emails), "EMAIL");

    let match = rawId ? idIndex.get(rawId) : undefined;
    if (rawId && !match) {
      if (existsAnywhere.has(rawId)) {
        // A real record this user cannot write. Skipping rather than creating: the
        // row asked to update that contact, and an export of contacts shared with
        // you would otherwise duplicate every one of them on re-import.
        planned.push({
          line,
          action: "skip",
          personId: null,
          // The name from the file, not from the record — the row is theirs, the
          // record may not be.
          displayName: [read.get(row, COLUMNS.givenName), read.get(row, COLUMNS.familyName)]
            .filter(Boolean)
            .join(" "),
          changes: [],
          warnings: ["You do not have edit access to that contact, so this row is skipped."],
          write: null,
        });
        return;
      }
      warnings.push(
        `Hearth ID “${rawId}” is not a contact in this Hearth — treated as a new contact.`,
      );
    }
    if (!match) {
      for (const e of emails) {
        const hit = emailIndex.get(e.value.toLowerCase());
        if (hit) {
          match = hit;
          changes.push(`matched your existing contact by ${e.value}`);
          break;
        }
      }
    }

    // Two rows landing on one contact means the later would silently overwrite the
    // earlier. Skipping is the only outcome that does not lose data invisibly.
    if (match && seenIds.has(match.id)) {
      planned.push({
        line,
        action: "skip",
        personId: match.id,
        displayName: match.displayName,
        changes: [],
        warnings: [`Another row in this file already updates ${match.displayName}.`],
        write: null,
      });
      return;
    }

    const isNew = !match;
    const ownerId = match?.ownerId ?? userId;
    const ownedByMe = ownerId === userId;

    // --- field values -------------------------------------------------------
    //
    // Gathered as a FieldValues map and handed to partitionFieldValues, the same
    // function the edit form uses. That is what converts a validated "1990-04-03"
    // into the Date the column wants; doing the conversion here instead would be a
    // second implementation of the rule, free to drift from the first.
    const values: FieldValues = {};

    for (const [key, header] of CORE_TEXT_COLUMNS) {
      if (read.has(header)) values[key] = read.get(row, header) || null;
    }
    if (read.has(COLUMNS.birthday)) {
      const cell = read.get(row, COLUMNS.birthday);
      if (!cell) values.birthday = null;
      else {
        const def = defs.find((d) => d.key === "birthday");
        const parsed = def ? parseOneField(def, csvRawValue("DATE", cell)) : null;
        if (parsed?.ok) values.birthday = parsed.value;
        else warnings.push(`Birthday “${cell}” is not a date Hearth understands (use YYYY-MM-DD) — left unchanged.`);
      }
    }

    const nameParts = {
      givenName: (values.givenName as string | null) ?? null,
      familyName: (values.familyName as string | null) ?? null,
      nickname: (values.nickname as string | null) ?? null,
      organization: (values.organization as string | null) ?? null,
    };
    // computeDisplayName falls back to "Unnamed contact", so it cannot be used to
    // detect a row with nothing in it — that has to be asked of the parts directly.
    const hasAnyName = Object.values(nameParts).some((v) => (v ?? "").trim());
    const displayName = hasAnyName
      ? computeDisplayName(nameParts)
      : (match?.displayName ?? "");

    if (isNew && !hasAnyName) {
      planned.push({
        line,
        action: "skip",
        personId: null,
        displayName: "",
        changes: [],
        warnings: ["No name, organisation or nickname — nothing to identify this contact by."],
        write: null,
      });
      return;
    }

    // --- custom fields ---
    const customKeys: string[] = [];
    if (customByHeader.size > 0 && !ownedByMe) {
      warnings.push(
        "Custom fields are keyed by the owner's definitions, so they are left unchanged on a contact shared with you.",
      );
    } else {
      for (const [header, def] of customByHeader) {
        const cell = read.get(row, header);
        const parsed = parseOneField(def, csvRawValue(def.type, cell));
        if (parsed.ok) {
          values[def.key] = parsed.value;
          customKeys.push(def.key);
        } else {
          warnings.push(`${def.label}: ${parsed.error} — left unchanged.`);
        }
      }
    }

    // Column coercion happens here, once, for core and custom alike.
    const { columns } = partitionFieldValues(defs, values, {}, { timeZone });
    // Custom values stay as a key -> value|null map rather than a merged bag: the
    // apply step needs to tell "set to null" (remove the key) from "not mentioned"
    // (leave it alone), and a merged bag has already lost that distinction.
    const custom: Record<string, unknown> = {};
    for (const key of customKeys) custom[key] = values[key] ?? null;

    // --- contact points ---
    let contactPoints: CsvContactPoint[] | null = null;
    const touchesContacts = KINDS.some((k) => read.has(CONTACT_KIND_COLUMN[k]));
    if (touchesContacts) {
      contactPoints = KINDS.flatMap((kind) =>
        read.has(CONTACT_KIND_COLUMN[kind])
          ? parseContactPoints(read.get(row, CONTACT_KIND_COLUMN[kind]), kind)
          : [],
      );
      // Replacing wholesale would delete kinds the file omits, so a file with only
      // an Emails column must not wipe everyone's phone numbers.
      if (!KINDS.every((k) => read.has(CONTACT_KIND_COLUMN[k]))) {
        const missing = KINDS.filter((k) => !read.has(CONTACT_KIND_COLUMN[k]));
        warnings.push(
          `No ${missing.map((m) => CONTACT_KIND_COLUMN[m].toLowerCase()).join("/")} column, so existing ones are kept.`,
        );
      }
    }

    // --- labels ---
    let labelNames: string[] | null = null;
    if (read.has(COLUMNS.labels)) {
      if (!ownedByMe) {
        warnings.push(
          "Labels belong to the contact's owner, so they are left unchanged on a contact shared with you.",
        );
      } else {
        labelNames = parseLabelList(read.get(row, COLUMNS.labels)).map(normaliseLabelName);
        for (const name of labelNames) {
          const key = labelKey(name);
          if (!labelIndex.has(key) && !newLabelKeys.has(key)) {
            newLabelKeys.add(key);
            newLabels.push(name);
          }
        }
      }
    }

    // --- shares (grant only) ---
    const shares: { userId: string; permission: SharePermission }[] = [];
    if (read.has(COLUMNS.sharedWith)) {
      const wanted = parseShares(read.get(row, COLUMNS.sharedWith));
      if (wanted.length > 0 && !ownedByMe) {
        warnings.push("Only a contact's owner can share it, so sharing is skipped for this row.");
      } else {
        for (const s of wanted) {
          const id = userIndex.get(s.email);
          if (!id) continue; // already reported once, at the top of the plan
          if (id === userId) continue;
          shares.push({ userId: id, permission: s.permission });
        }
      }
    }

    // --- add to Google ---
    let addToGoogle: boolean | null = null;
    if (read.has(COLUMNS.addToGoogle)) {
      const cell = read.get(row, COLUMNS.addToGoogle);
      if (cell) addToGoogle = csvRawValue("BOOLEAN", cell) === true;
    }

    if (!ownedByMe) changes.push("shared contact — editing the owner's record");
    if (contactPoints?.length) changes.push(`${contactPoints.length} contact detail(s)`);
    if (labelNames?.length) changes.push(`labels: ${labelNames.join(", ")}`);
    if (labelNames?.length === 0) changes.push("clears all labels");
    if (shares.length) changes.push(`shares with ${shares.length} user(s)`);
    if (addToGoogle !== null) changes.push(`Add to Google: ${addToGoogle}`);

    planned.push({
      line,
      action: isNew ? "create" : "update",
      personId: match?.id ?? null,
      displayName,
      changes,
      warnings,
      write: {
        personId: match?.id ?? null,
        ownerId,
        columns,
        custom,
        contactPoints,
        labelNames,
        shares,
        addToGoogle,
      },
    });

    if (match) seenIds.add(match.id);
  });

  return {
    headers,
    unknownHeaders,
    rows: planned,
    counts: {
      create: planned.filter((r) => r.action === "create").length,
      update: planned.filter((r) => r.action === "update").length,
      skip: planned.filter((r) => r.action === "skip").length,
      warnings: planned.filter((r) => r.warnings.length > 0).length,
    },
    newLabels,
    unknownShareEmails,
    fatal: null,
  };
}
