import { prisma } from "@/lib/db";

/**
 * Everyone else signed in to this install, for the sharing pickers.
 *
 * Exposing the other users' emails is inherent to sharing on a self-hosted install:
 * you cannot grant access to someone you cannot name. It stays inside the app —
 * sign-in is required to reach any page that renders it.
 */
export interface ShareableUser {
  id: string;
  email: string;
  name: string | null;
}

export async function listOtherUsers(userId: string): Promise<ShareableUser[]> {
  const users = await prisma.user.findMany({
    where: { id: { not: userId }, email: { not: null } },
    select: { id: true, email: true, name: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
  // email is nullable in the Auth.js schema but always present for Google sign-in;
  // the filter above keeps the type honest rather than asserting.
  return users.flatMap((u) => (u.email ? [{ id: u.id, email: u.email, name: u.name }] : []));
}
