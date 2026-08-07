import { prisma } from "@/lib/db";
import { buildInfo } from "@/lib/version";

// Docker's healthcheck hits this, so it must never be cached or prerendered.
export const dynamic = "force-dynamic";

/**
 * Liveness plus build identity.
 *
 * The build fields are what let you answer "is the version I just deployed
 * actually the one serving traffic?" from outside the container — including from
 * a monitor that cannot authenticate. Note this is deliberately unauthenticated:
 * it discloses the running version to anyone who can reach the endpoint. For a
 * personal install behind your own proxy that trade is worth it; if you would
 * rather not advertise it, drop `...buildInfo()` from the ok response.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "up", ...buildInfo() });
  } catch {
    // Deliberately terse on failure — no build details, no error text.
    return Response.json({ status: "degraded", database: "down" }, { status: 503 });
  }
}
