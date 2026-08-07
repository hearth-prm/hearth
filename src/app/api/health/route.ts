import { prisma } from "@/lib/db";

// Docker's healthcheck hits this, so it must never be cached or prerendered.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "up" });
  } catch {
    // Deliberately opaque: the endpoint is reachable without auth.
    return Response.json({ status: "degraded", database: "down" }, { status: 503 });
  }
}
