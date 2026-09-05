import type { Attachment, OutgoingMail } from "@/lib/google/mail";

/**
 * Why this install cannot send a thank-you, when it cannot.
 *
 * `canSendMail` answers a boolean, and three unrelated things make it false: the write
 * switch is off, mail was never enabled for the install, or the Google grant lacks the
 * send scope. The gift row used to render all three as one disabled button whose only
 * explanation was a `title` — and it guessed the reason wrong, telling somebody to
 * reconnect Google when reconnecting could not have helped. A cause collapsed into a
 * boolean has to be guessed at by whoever displays it.
 *
 * `short` goes where the link would have been, so the row says why at a glance. `full` is
 * the hover, and says what to do about it.
 */
export interface MailBlock {
  short: string;
  full: string;
}

/** How a note to several givers is addressed. */
export const ADDRESSING_MODES = ["together", "separate", "bcc"] as const;
export type Addressing = (typeof ADDRESSING_MODES)[number];

export function isAddressing(value: string): value is Addressing {
  return (ADDRESSING_MODES as readonly string[]).includes(value);
}

/**
 * What each choice does, in the words the dropdown shows.
 *
 * Kept beside the type rather than in the component, so the explanation the sender reads and
 * the behaviour the sender gets are defined in one place.
 */
export const ADDRESSING_LABELS: Record<Addressing, string> = {
  together: "One email to everyone",
  separate: "A separate email to each",
  bcc: "One email, addresses hidden",
};

export const ADDRESSING_HELP: Record<Addressing, string> = {
  together:
    "One note with everyone in the To line. Reads as a shared thank-you, and everyone can see who else was thanked — right for a couple, or a family who know each other.",
  separate:
    "The same words sent individually, so nobody sees the others' addresses and each note arrives as their own. Right for people who do not know each other.",
  bcc: "One note with every address hidden, addressed to you. Private, but it reads a little oddly to whoever opens it.",
};

/**
 * The thank-you note itself.
 *
 * Pure: it takes what was written and returns a message, touching neither the database
 * nor Google. That is what lets the wording be checked without a mailbox.
 *
 * Deliberately thin. The body is the sender's own words and nothing is added around
 * them — no template, no signature, no "sent from Hearth" footer. A thank-you that
 * visibly came out of a contact manager is a worse thank-you, and the whole point of
 * writing it here rather than being reminded to write it elsewhere is that what arrives
 * is indistinguishable from a note typed by hand.
 *
 * That extends to attachments and to how a group note is addressed: neither adds a line of
 * explanation to the body. A photograph arrives as a photograph.
 */
export function buildThankYouMail({
  to,
  bcc,
  giftDescription,
  message,
  attachments,
}: {
  /** Visible recipients. Several when one note thanks several people together. */
  to: string[];
  bcc?: string[];
  /** Names the subject line, so the reader knows what it is about before opening. */
  giftDescription: string;
  message: string;
  attachments?: readonly Attachment[];
}): OutgoingMail {
  const subject = `Thank you for the ${giftDescription}`;

  return {
    to,
    ...(bcc && bcc.length > 0 ? { bcc } : {}),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    subject,
    text: message,
    // Paragraphs preserved, and nothing else interpreted: the sender typed prose, not
    // markup, and any < or & they used is theirs rather than a tag.
    html: message
      .split(/\n{2,}/)
      .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
      .join("\n"),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
