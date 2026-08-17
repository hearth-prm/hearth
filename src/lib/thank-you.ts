import type { OutgoingMail } from "@/lib/google/mail";

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
 */
export function buildThankYouMail({
  to,
  giftDescription,
  message,
}: {
  to: string;
  /** Names the subject line, so the reader knows what it is about before opening. */
  giftDescription: string;
  message: string;
}): OutgoingMail {
  const subject = `Thank you for the ${giftDescription}`;

  return {
    to,
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
