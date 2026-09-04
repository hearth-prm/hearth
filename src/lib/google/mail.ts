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

export interface Attachment {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface OutgoingMail {
  /**
   * Visible recipients. Several when one note thanks several people together, which is what
   * makes it read as a shared note rather than as duplicates.
   */
  to: string[];
  /**
   * Hidden recipients, for a group note to people who should not see each other's addresses.
   * Gmail requires at least one visible recipient, so a bcc-only send puts the sender in To.
   */
  bcc?: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: readonly Attachment[];
}

/**
 * Base64 in 76-character lines, as RFC 2045 requires.
 *
 * Gmail accepts one enormous line, so this looks like pedantry until a message reaches a
 * client that does not — at which point the attachment is corrupt and nothing in the send
 * response said so.
 */
function base64Lines(bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return (base64.match(/.{1,76}/g) ?? []).join("\r\n");
}

/**
 * A filename in a MIME parameter.
 *
 * Plain when it is ASCII; RFC 2231 when it is not. A name with an accent in it passed through
 * raw arrives mangled or drops the parameter altogether, which turns a photograph into
 * "noname".
 */
function filenameParams(filename: string): string[] {
  const safe = filename.replace(/[\r\n"\\]/g, "_");
  if (/^[\x20-\x7e]*$/.test(safe)) {
    return [`name="${safe}"`, `filename="${safe}"`];
  }
  const encoded = encodeURIComponent(safe).replace(/'/g, "%27");
  return [`name*=UTF-8''${encoded}`, `filename*=UTF-8''${encoded}`];
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
  const alt = "hearth-alt-9f2a4c";
  const mixed = "hearth-mixed-4b7e21";
  const subject = `=?UTF-8?B?${Buffer.from(mail.subject, "utf8").toString("base64")}?=`;
  const attachments = mail.attachments ?? [];

  // The body, always multipart/alternative. With attachments it becomes one part of a
  // multipart/mixed wrapper rather than the whole message — the nesting order matters: a
  // client that shows the HTML has to find both alternatives beside each other, not beside a
  // photograph.
  const body = [
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(mail.text, "utf8").toString("base64"),
    "",
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(mail.html, "utf8").toString("base64"),
    "",
    `--${alt}--`,
  ];

  const headers = [
    `To: ${mail.to.join(", ")}`,
    ...(mail.bcc && mail.bcc.length > 0 ? [`Bcc: ${mail.bcc.join(", ")}`] : []),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ];

  if (attachments.length > 0) {
    return toRaw([
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      "",
      `--${mixed}`,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      ...body,
      "",
      ...attachments.flatMap((a) => {
        const [nameParam, dispositionParam] = filenameParams(a.filename);
        return [
          `--${mixed}`,
          `Content-Type: ${a.mimeType}; ${nameParam}`,
          `Content-Disposition: attachment; ${dispositionParam}`,
          "Content-Transfer-Encoding: base64",
          "",
          base64Lines(a.bytes),
          "",
        ];
      }),
      `--${mixed}--`,
      "",
    ]);
  }

  return toRaw([
    ...headers,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    ...body,
    "",
  ]);
}

/** Gmail wants base64url: the + and / of standard base64 are meaningful in a URL. */
function toRaw(lines: string[]): string {
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
