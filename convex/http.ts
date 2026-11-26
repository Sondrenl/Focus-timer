import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { isAllowedAppOrigin } from "./push";

const http = httpRouter();

function buildCorsHeaders(req: Request): Record<string, string> {
  const originHeader = req.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  if (originHeader) {
    try {
      const url = new URL(originHeader);
      if (isAllowedAppOrigin(url)) {
        headers["Access-Control-Allow-Origin"] = url.origin;
      }
    } catch {
      // Ignore malformed Origin
    }
  }
  return headers;
}

async function sha256Hex(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

http.route({
  path: "/push/rotate",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, req) => {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(req),
    });
  }),
});

http.route({
  path: "/push/rotate",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const corsHeaders = buildCorsHeaders(req);
    const jsonHeaders = {
      ...corsHeaders,
      "Content-Type": "application/json",
    };

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    if (!rawBody || typeof rawBody !== "object") {
      return new Response(JSON.stringify({ error: "Request body must be a JSON object." }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const body = rawBody as Record<string, unknown>;
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    const rotationToken = typeof body.rotationToken === "string" ? body.rotationToken.trim() : "";
    const nextRotationTokenHash =
      typeof body.nextRotationTokenHash === "string" && body.nextRotationTokenHash.trim()
        ? body.nextRotationTokenHash.trim()
        : undefined;
    const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    const p256dh = typeof body.p256dh === "string" ? body.p256dh.trim() : "";
    const auth = typeof body.auth === "string" ? body.auth.trim() : "";

    if (
      !deviceId ||
      !rotationToken ||
      rotationToken.length < 32 ||
      rotationToken.length > 256 ||
      !endpoint ||
      !p256dh ||
      !auth
    ) {
      return new Response(JSON.stringify({ error: "Missing or invalid rotation fields." }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const currentTokenHash = await sha256Hex(rotationToken);

    try {
      const result = await ctx.runMutation(internal.push.rotateSubscription, {
        deviceId,
        currentTokenHash,
        nextTokenHash: nextRotationTokenHash,
        endpoint,
        p256dh,
        auth,
      });

      if (!result.rotated) {
        return new Response(JSON.stringify({ error: "Invalid rotation credentials." }), {
          status: 401,
          headers: jsonHeaders,
        });
      }

      return new Response(JSON.stringify({ rotated: true }), {
        status: 200,
        headers: jsonHeaders,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Validation failed.";
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
  }),
});

export default http;
