import { route, ok } from "@/server/http";
import { dashboardStats } from "@/server/views";
export const dynamic = "force-dynamic";
export const GET = route(async () => ok(dashboardStats()));
