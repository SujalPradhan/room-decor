import { env } from "cloudflare:workers";
import { handleStudioRequest, type StudioEnv } from "../../../server/studio";
/** Sites dispatch owns authenticated-user headers; this route must stay behind that boundary. */
export async function GET(request: Request) {
  return handleStudioRequest(request, env as unknown as StudioEnv);
}
export async function POST(request: Request) {
  return handleStudioRequest(request, env as unknown as StudioEnv);
}
