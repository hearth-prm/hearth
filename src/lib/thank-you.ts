import type { ThankYouGift } from "@/lib/gifts";
import type { OutgoingMail } from "@/lib/google/mail";

/**
 * The thank-you note itself.
 *
 * Pure: it takes a list and returns a message, touching neither the database nor
 * Google. That is what lets the wording be tested without a mailbox, and it keeps the
 * one piece a person will actually read out of the transport code.
 *
 * The point of the mail is to make writing thank-yous possible away from Hearth, so
 * each giver's contact details travel WITH their gift rather than in a separate list
 * the reader would have to cross-reference on a phone screen.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "Alice — alice@example.com · 555 0101" — only the parts that exist. */
function contactLine(gift: ThankYouGift): string {
  return [gift.giverEmail, gift.giverPhone, gift.giverAddress]
    .filter(Boolean)
    .join(" · ");
}

export function buildThankYouMail({
  to,
  recipientName,
  occasion,
  gifts,
}: {
  to: string;
  recipientName: string;
  /** Event title, or null for one-off gifts. */
  occasion: string | null;
  gifts: readonly ThankYouGift[];
}): OutgoingMail {
  const subject = occasion
    ? `Thank-you list for ${occasion}`
    : `Thank-you list for ${recipientName}`;

  const intro = occasion
    ? `Gifts ${recipientName} received at ${occasion}:`
    : `Gifts ${recipientName} received:`;

  const text = [
    intro,
    "",
    ...gifts.map((gift) => {
      const details = contactLine(gift);
      // Named per line only when the list is not already about one occasion, so a
      // single-event reminder does not repeat its own title on every row.
      const where = !occasion && gift.occasion ? ` (${gift.occasion})` : "";
      return [
        `• ${gift.description}${where} — from ${gift.giverName}`,
        details ? `  ${details}` : null,
        gift.notes ? `  (${gift.notes})` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }),
    "",
    "Sent from Hearth.",
  ].join("\n");

  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    "<ul>",
    ...gifts.map((gift) => {
      const details = contactLine(gift);
      const where = !occasion && gift.occasion ? ` (${escapeHtml(gift.occasion)})` : "";
      return [
        "<li>",
        `<strong>${escapeHtml(gift.description)}</strong>${where} — from ${escapeHtml(gift.giverName)}`,
        details ? `<br><span style="color:#666">${escapeHtml(details)}</span>` : "",
        gift.notes ? `<br><em>${escapeHtml(gift.notes)}</em>` : "",
        "</li>",
      ].join("");
    }),
    "</ul>",
    '<p style="color:#666;font-size:12px">Sent from Hearth.</p>',
  ].join("\n");

  return { to, subject, text, html };
}
