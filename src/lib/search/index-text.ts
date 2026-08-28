import { createHash } from "node:crypto";
import type { ContactKind } from "@prisma/client";

/**
 * The text a contact is embedded as.
 *
 * Pure, and the most carefully scoped part of semantic search — because a vector is built
 * ONCE and scored for every viewer. There is no per-viewer index and there should not be, so
 * whatever goes in here must be text that EVERYBODY who can read the contact can already
 * read. Anything else would leak through a ranking: a contact rising to the top for
 * "chemotherapy" tells you something even if the page never shows you why.
 *
 * That rules two things out that would otherwise be obvious to include:
 *
 *   * **gifts this person GAVE.** A gift follows its recipient, so seeing Mary does not
 *     entitle you to what she gave a household you have no access to. Gifts RECEIVED are
 *     fine: a gift is readable to whoever may read its recipient, and the recipient here is
 *     the contact being indexed.
 *   * **events they attended.** Events have their own access clause, and it does not follow
 *     the guest's — so an event title in a guest's vector is readable through a contact by
 *     somebody with no access to the event.
 *
 * Labels are in, because a shared contact carries its owner's labels and reads the same for
 * everyone who can see it.
 *
 * Exact-match fields are deliberately left out even though they are visible to all readers:
 * emails, phones and addresses are already searchable precisely, and embedding them makes
 * "Sun Prairie" a fuzzy match — strictly worse than `city:"Sun Prairie"`, and noise in every
 * other query's ranking.
 */

/** Contact-point kinds that say something about a person rather than how to reach them. */
const DESCRIPTIVE_KINDS: readonly ContactKind[] = [
  "OCCUPATION",
  "SKILL",
  "INTEREST",
  "KEYWORD",
];

export interface IndexablePerson {
  organization: string | null;
  jobTitle: string | null;
  orgDepartment: string | null;
  orgJobDescription: string | null;
  orgLocation: string | null;
  orgType: string | null;
  notes: string | null;
  labels: readonly { label: { name: string } }[];
  contactPoints: readonly { kind: ContactKind; label: string | null; value: string }[];
  /** Gifts this person RECEIVED. Given ones are excluded; see above. */
  giftsReceived: readonly { gift: { description: string } }[];
}

/** The Prisma selection that produces an IndexablePerson, kept beside the type it feeds. */
export const INDEXABLE_SELECT = {
  organization: true,
  jobTitle: true,
  orgDepartment: true,
  orgJobDescription: true,
  orgLocation: true,
  orgType: true,
  notes: true,
  labels: { select: { label: { select: { name: true } } } },
  contactPoints: { select: { kind: true, label: true, value: true } },
  giftsReceived: { select: { gift: { select: { description: true } } } },
} as const;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Labelled lines rather than a bare concatenation.
 *
 * "Job: Registered Nurse" embeds better than "Registered Nurse" alone — the model is reading
 * a short document, and a document with a shape is easier to place than a pile of words. It
 * also makes the text worth looking at when a ranking surprises somebody.
 *
 * Deterministic in ordering and spacing, because the hash of this string is what decides
 * whether a contact needs re-embedding. A set iterated in insertion order, a label list
 * sorted: anything that could reorder between two reads would re-embed the whole address
 * book on every pass.
 */
export function indexableText(person: IndexablePerson): string {
  const lines: string[] = [];
  const add = (label: string, value: string) => {
    if (value) lines.push(`${label}: ${value}`);
  };

  add("Organisation", clean(person.organization));
  add("Job", clean(person.jobTitle));
  add("Department", clean(person.orgDepartment));
  add("Role", clean(person.orgJobDescription));
  add("Works at", clean(person.orgLocation));
  add("Kind of organisation", clean(person.orgType));

  const labels = person.labels.map((l) => clean(l.label.name)).filter(Boolean).sort();
  add("Labels", labels.join(", "));

  for (const kind of DESCRIPTIVE_KINDS) {
    const values = person.contactPoints
      .filter((c) => c.kind === kind)
      .map((c) => clean(c.label ? `${c.label} ${c.value}` : c.value))
      .filter(Boolean)
      .sort();
    if (values.length) add(kind.charAt(0) + kind.slice(1).toLowerCase(), values.join(", "));
  }

  const gifts = person.giftsReceived
    .map((g) => clean(g.gift.description))
    .filter(Boolean)
    .sort();
  add("Gifts received", gifts.join(", "));

  // Notes last and unsorted: it is prose, and it is the field most likely to carry the thing
  // somebody will search for, so it should not be truncated by anything above it.
  add("Notes", clean(person.notes));

  return lines.join("\n");
}

/**
 * What decides whether a contact needs re-embedding.
 *
 * The model name is part of the hash, so changing OLLAMA_EMBED_MODEL invalidates every row
 * without a separate migration or a manual rebuild — two models put "nurse" in different
 * places, and comparing across them ranks by nothing at all.
 */
export function sourceHash(text: string, model: string): string {
  return createHash("sha256").update(`${model}\n${text}`).digest("hex").slice(0, 32);
}
