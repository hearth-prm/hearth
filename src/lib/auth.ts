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
    /**
     * Keep the stored grant in step with what Google actually allows.
     *
     * The adapter writes an Account row once, at first link, and has no way to update
     * it — so without this, re-consenting to add a scope changed nothing Hearth could
     * see, and "Reconnect Google" stayed on screen for good. Best-effort like the rest
     * of these: a failed write must not turn a valid sign-in into an error page.
     */
    async signIn({ user, account }) {
      if (!user.id || account?.provider !== "google") return;
      // grant.ts deliberately imports nothing but Prisma: this module is reachable
      // from a client component via access.ts, so an edge to anything that pulls in
      // googleapis would send the Node-only SDK to the browser.
      const { persistGoogleGrant } = await import("@/lib/google/grant");
      await persistGoogleGrant(user.id, account).catch(() => undefined);
    },

    async createUser({ user }) {
      if (!user.id) return;
      // Best-effort: getUserSettings() also upserts, so a failure here (or a
      // race with a concurrent first request) is not fatal.
      await prisma.userSettings
        .create({ data: { userId: user.id } })
        .catch(() => undefined);

      // A contact card for the new user, and shares so every card reaches every user.
      // Also best-effort: a household without one person's card is a smaller problem
      // than a sign-in that fails, and ensureContactCard is idempotent, so the next
      // person to join repairs it.
      const { ensureContactCard } = await import("@/lib/household");
      await ensureContactCard(user.id).catch(() => undefined);
    },
  },
});
