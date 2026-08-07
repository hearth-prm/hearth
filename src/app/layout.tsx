import type { Metadata } from "next";
import "./globals.css";
import { currentUser } from "@/lib/access";
import { AppNav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Hearth",
  description: "A self-hosted personal relationship manager",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();

  return (
    <html lang="en">
      <body className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {user ? <AppNav user={user} /> : null}
        <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
