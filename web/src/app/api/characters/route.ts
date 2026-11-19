import { route, ok } from "@/server/http";
import { loadCharacters } from "@/server/pipeline/context";
export const dynamic = "force-dynamic";
/** Characters that pass the registry validator, plus the validator's errors/warnings (shown, never hidden). */
export const GET = route(async () => ok(await loadCharacters()));
