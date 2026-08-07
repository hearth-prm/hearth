import { redirect } from "next/navigation";
import { currentUser } from "@/lib/access";

export default async function RootPage() {
  const user = await currentUser();
  redirect(user ? "/people" : "/signin");
}
