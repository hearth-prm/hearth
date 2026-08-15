import { getGoogleClient, GoogleAuthError } from "@/lib/google/auth";
import { GMAIL_SEND_SCOPE } from "@/lib/google/scopes";
import { prisma } from "@/lib/db";

/**
 * Sending mail as the signed-in user, via Gmail.
 *
 * Hearth had never sent an email before this: calendar invitations are sent by Google
 * on our behalf, not by us. So this is the whole of the mail stack, and it is
 * deliberately small — one message type, no queue, no templates engine.
 */

/** Whether this user has granted the optional send permission. */
export async function canSendMail(userId: string): Promise<boolean> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { scope: true },
  });
  return (account?.scope ?? "").split(/\s+/).includes(GMAIL_SEND_SCOPE);
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Encode a message as RFC 2822, then base64url as Gmail wants it.
 *
 * Subject is RFC 2047 encoded rather than passed through: a subject naming a person is
 * one accented character away from arriving as mojibake, and there is no way to tell
 * from the send response that it did. The body needs no such treatment because it
 * declares UTF-8 and is base64'd whole.
 */
export function buildMessage(mail: OutgoingMail): string {
  const boundary = "hearth-boundary-9f2a4c";
  const subject = `=?UTF-8?B?${Buffer.from(mail.subject, "utf8").toString("base64")}?=`;

  const lines = [
    `To: ${mail.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(mail.text, "utf8").toString("base64"),
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(mail.html, "utf8").toString("base64"),
    "",
    `--${boundary}--`,
    "",
  ];

  // Gmail wants base64url, not plain base64: the + and / of standard base64 are
  // meaningful in a URL and the API rejects them.
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

const SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/**
 * Send, over plain fetch rather than through the googleapis client.
 *
 * `google.gmail()` would pull the whole gmail_v1 surface in on top of People and
 * Calendar, which is a lot of weight to carry for a single POST in a container built on
 * a home server. The OAuth2 client is still used for the token, so refresh and the
 * invalid-grant handling stay in the one place that knows about them.
 */
export async function sendMail(userId: string, mail: OutgoingMail): Promise<void> {
  if (!(await canSendMail(userId))) {
    throw new GoogleAuthError(
      "Hearth has not been given permission to send mail as you.",
    );
  }

  const auth = await getGoogleClient(userId);
  const { token } = await auth.getAccessToken();
  if (!token) throw new GoogleAuthError("Could not obtain a Google access token.");

  const response = await fetch(SEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: buildMessage(mail) }),
  });

  if (!response.ok) {
    // Google's error body says considerably more than the status does — a missing
    // scope and a malformed message are both 400 — so it is worth carrying through.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Gmail refused the message (${response.status}). ${detail.slice(0, 300)}`,
    );
  }
}
