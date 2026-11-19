import { MEETING_BREAK_CONFIG } from "@/lib/session-break-config";
import { createSessionBreakRouteHandlers } from "@/lib/session-break-route";

const handlers = createSessionBreakRouteHandlers(MEETING_BREAK_CONFIG);

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
