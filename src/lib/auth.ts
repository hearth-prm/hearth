import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { GOOGLE_SCOPES } from "@/lib/google/scopes";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Database sessions (rather than JWT) because the Google refresh token lives
  // in the Account row and the sync worker needs to load it server-side by user
  // id, outside of any request that carries a JWT.
  session: { strategy: "database" },
  // Self-hosted installs sit behind a reverse proxy; AUTH_URL is authoritative.
  trustHost: true,
  pages: { signIn: "/signin" },
  providers: [
    Google({
      authorization: {
        params: {
          scope: GOOGLE_SCOPES.join(" "),
          // access_type=offline + prompt=consent is what actually yields a
          // refresh_token. Google only returns one on the first consent unless
          // consent is re-prompted, and without it background sync dies as soon
          // as the hour-long access token expires.
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
        },
      },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      // Best-effort: getUserSettings() also upserts, so a failure here (or a
      // race with a concurrent first request) is not fatal.
      await prisma.userSettings
        .create({ data: { userId: user.id } })
        .catch(() => undefined);
    },
  },
});
