/**
 * Does the embedding model actually rank the way the feature promises?
 *
 * The e2e suite proves the PLUMBING with a deterministic stand-in model — indexing,
 * staleness, scoping, failure. It cannot prove that nomic-embed-text puts "Registered Nurse"
 * near "healthcare", because that is a fact about the model rather than about Hearth. This
 * script asks the real one, and is the thing to run after changing OLLAMA_EMBED_MODEL.
 *
 *   OLLAMA_URL=http://host:11434 npx tsx scripts/probe-semantic.mts
 *
 * Read-only: it touches no database and writes nothing. The contacts below are invented.
 */
import { cosine, embedTexts, embeddingModel } from "@/lib/search/embed";
import { indexableText } from "@/lib/search/index-text";

const EMPTY = {
  orgDepartment: null,
  orgJobDescription: null,
  orgLocation: null,
  orgType: null,
  labels: [],
  contactPoints: [],
  giftsReceived: [],
};

const PEOPLE = [
  { name: "Nadia", ...EMPTY, organization: "UW Health", jobTitle: "Registered Nurse",
    notes: "Works nights on the oncology ward" },
  { name: "Dev", ...EMPTY, organization: "TheStreet", jobTitle: "Java developer",
    notes: "Argues about the database" },
  { name: "Gordon", ...EMPTY, organization: null, jobTitle: "Landscaper",
    notes: "Grows roses, keeps an allotment" },
  { name: "Mira", ...EMPTY, organization: "Madison Schools", jobTitle: "Third grade teacher",
    notes: "Coaches the reading club" },
];

/** Each query with the contact it ought to rank first. */
const EXPECTED: readonly [string, string][] = [
  ["healthcare", "Nadia"],
  ["who works with children", "Mira"],
  ["gardening", "Gordon"],
  ["writes code", "Dev"],
];

const documents = await embedTexts(PEOPLE.map((p) => indexableText(p)), "document");
if (!documents.ok) {
  console.error(`could not reach the model: ${documents.message}`);
  process.exit(1);
}
console.log(`${embeddingModel()}, ${documents.vectors[0]!.length} dimensions\n`);

let wrong = 0;
for (const [query, expected] of EXPECTED) {
  const asked = await embedTexts([query], "query");
  if (!asked.ok) {
    console.error(`could not embed “${query}”: ${asked.message}`);
    process.exit(1);
  }
  const ranked = PEOPLE.map((p, i) => ({
    name: p.name,
    score: cosine(asked.vectors[0]!, documents.vectors[i]!),
  })).sort((a, b) => b.score - a.score);
  const ok = ranked[0]!.name === expected;
  if (!ok) wrong += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${query.padEnd(24)} ${ranked
      .map((r) => `${r.name} ${r.score.toFixed(3)}`)
      .join("  ")}`,
  );
}

// Not an assertion, a demonstration: this is what a ranking looks like when the query is
// something an embedding cannot express. Every score lands in the same narrow band and the
// order is noise — which is why `semantic:` refuses negation and keeps a COUNT rather than a
// similarity threshold. A threshold would have to separate 0.39 from 0.57.
const negation = await embedTexts(["no email"], "query");
if (negation.ok) {
  const ranked = PEOPLE.map((p, i) => ({
    name: p.name,
    score: cosine(negation.vectors[0]!, documents.vectors[i]!),
  })).sort((a, b) => b.score - a.score);
  console.log(
    `\nfor comparison, a question an embedding cannot answer:\n     ${"no email".padEnd(24)} ${ranked
      .map((r) => `${r.name} ${r.score.toFixed(3)}`)
      .join("  ")}`,
  );
}

console.log(wrong === 0 ? "\nevery query ranked as expected" : `\n${wrong} ranked wrong`);
process.exit(wrong === 0 ? 0 : 1);
