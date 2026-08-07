import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { currentUser } from "@/lib/access";
import { SCOPE_DESCRIPTIONS } from "@/lib/google/scopes";
import { btnPrimary, Card } from "@/components/ui";

const AUTH_ERRORS: Record<string, string> = {
  OAuthAccountNotLinked:
    "That Google account is already linked to a different Hearth user.",
  AccessDenied: "Google sign-in was cancelled or denied.",
  Configuration:
    "Hearth is misconfigured — check AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const user = await currentUser();
  if (user) redirect("/people");

  const { error } = await searchParams;
  const message = error
    ? (AUTH_ERRORS[error] ?? "Sign-in failed. Please try again.")
    : null;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-10">
      <div className="text-center">
        <p aria-hidden className="text-4xl">
          🏠
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Hearth</h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Your own personal relationship manager. Keep track of the people in
          your life, and who was where.
        </p>
      </div>

      {message ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
          {message}
        </p>
      ) : null}

      <Card className="p-6">
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/people" });
          }}
        >
          <button type="submit" className={`${btnPrimary} w-full`}>
            Continue with Google
          </button>
        </form>

        <div className="mt-5 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Hearth will ask Google for permission to:
          </p>
          <ul className="mt-2 space-y-1.5">
            {Object.entries(SCOPE_DESCRIPTIONS).map(([scope, description]) => (
              <li
                key={scope}
                className="flex gap-2 text-xs text-neutral-500 dark:text-neutral-400"
              >
                <span aria-hidden className="text-neutral-400">
                  •
                </span>
                {description}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            Nothing is sent to Google until you turn syncing on in Settings.
            Hearth is always the source of truth — it writes to Google, never the
            other way around (except event RSVPs, if you enable that).
          </p>
        </div>
      </Card>
    </div>
  );
}
