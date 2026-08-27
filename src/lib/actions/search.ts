"use server";

import { requireUserForAction } from "@/lib/access";
import { loadRegistry } from "@/lib/fields/registry";
import { prisma } from "@/lib/db";
import { searchVocabulary } from "@/lib/search/compile";
import { translateToQuery, type Translation } from "@/lib/search/nl";
import { isFrameworkError, readString, toActionError } from "@/lib/actions/shared";

/**
 * Turn a sentence into a query, for the search box to display.
 *
 * The vocabulary is built server-side from the asker's own registry and labels rather than
 * taken from the form: the model should be told about the fields and labels THIS user has, and
 * a list posted from a browser is neither trustworthy nor necessarily theirs.
 *
 * Returns the query for the box. Nothing is searched here — the person reads what the model
 * understood and presses Enter, or edits it first.
 */
export async function interpretSearch(
  _prev: Translation,
  form: FormData,
): Promise<Translation> {
  try {
    const user = await requireUserForAction();
    const sentence = readString(form, "sentence");

    const [registry, labels] = await Promise.all([
      loadRegistry(user.id, "PERSON"),
      prisma.label.findMany({
        where: { ownerId: user.id },
        select: { name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return await translateToQuery(
      sentence,
      searchVocabulary(registry, labels.map((l) => l.name)),
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    const failed = toActionError(err);
    return { ok: false, message: failed.message };
  }
}
