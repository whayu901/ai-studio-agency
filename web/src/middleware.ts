import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
// n8n in Docker reaches the host through Docker Desktop's host.docker.internal name.
const ORCHESTRATOR_HOSTS = new Set([...LOCAL_HOSTS, "host.docker.internal"]);

/**
 * Local-only guard:
 *  - refuse requests whose Host is not local (DNS-rebinding protection);
 *  - mutating dashboard API calls must send x-acs-client: dashboard. Browsers cannot add that
 *    header cross-site without a CORS preflight, which this app never allows, so other websites
 *    cannot post to the local API.
 * Orchestrator routes authenticate with x-acs-token in the route itself.
 */
export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  const isOrchestrator = req.nextUrl.pathname.startsWith("/api/orchestrator/");
  if (!(isOrchestrator ? ORCHESTRATOR_HOSTS : LOCAL_HOSTS).has(host)) {
    return NextResponse.json({ error: { code: "forbidden", message: "local access only" } }, { status: 403 });
  }
  if (req.nextUrl.pathname.startsWith("/api/") && !isOrchestrator && !["GET", "HEAD"].includes(req.method)) {
    if (req.headers.get("x-acs-client") !== "dashboard") {
      return NextResponse.json({ error: { code: "forbidden", message: "missing x-acs-client header" } }, { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
