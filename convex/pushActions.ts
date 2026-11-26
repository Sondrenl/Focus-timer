"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import * as webPush from "web-push";

const DEFAULT_APP_ORIGIN = "https://focus-timer.sondrelassen.workers.dev";
const PUSH_FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_MS = 3_000;
const TRANSIENT_RETRY_DELAY_MS = 500;

const PERMANENT_ERROR_REASONS = [
  "baddevicetoken",
  "unregistered",
  "vapidpkhashmismatch",
  "unauthorizedregistration",
  "mismatchsenderid",
  "notregistered",
  "invalidregistration",
];

type DeclarativePushPayload = {
  web_push: 8030;
  notification: {
    title: string;
    body: string;
    navigate: string;
    icon: string;
    badge: string;
    tag: string;
    silent: boolean;
    mutable: false;
    timestamp: number;
  };
};

interface VapidCredentials {
  publicKey: string;
  privateKey: string;
  subject: string;
}

function decodeBase64ToBytes(raw: string): Uint8Array {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4 || 4)) % 4), "=");
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function encodeBytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function resolveVapidCredentials(): VapidCredentials | null {
  const rawPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!rawPrivate) {
    console.error("[Push] VAPID_PRIVATE_KEY is missing; skipping push dispatch.");
    return null;
  }

  const subject =
    process.env.VAPID_SUBJECT?.trim() || "mailto:notifications@pomodor.app";
  const explicitPublic = process.env.VAPID_PUBLIC_KEY?.trim();

  // Support JWK JSON format (standard Convex env format: {"kty":"EC","crv":"P-256","x":"...","y":"...","d":"..."})
  if (rawPrivate.startsWith("{")) {
    try {
      const parsed = JSON.parse(rawPrivate) as {
        kty?: string;
        crv?: string;
        x?: string;
        y?: string;
        d?: string;
      };
      if (parsed.kty === "EC" && parsed.crv === "P-256" && parsed.x && parsed.y && parsed.d) {
        const x = decodeBase64ToBytes(parsed.x);
        const y = decodeBase64ToBytes(parsed.y);
        if (x.length === 32 && y.length === 32) {
          const uncompressed = new Uint8Array(65);
          uncompressed[0] = 0x04;
          uncompressed.set(x, 1);
          uncompressed.set(y, 33);
          const derivedPublic = encodeBytesToBase64Url(uncompressed);
          if (explicitPublic && explicitPublic !== derivedPublic) {
            console.error(
              "[Push] VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY JWK; using derived public key for VAPID auth."
            );
          }
          return {
            publicKey: derivedPublic,
            privateKey: parsed.d,
            subject,
          };
        }
      }
      console.error("[Push] VAPID_PRIVATE_KEY JSON is not a valid P-256 EC private JWK.");
      return null;
    } catch (err) {
      console.error("[Push] Failed to parse VAPID_PRIVATE_KEY JSON:", err);
      return null;
    }
  }

  // Raw base64url VAPID private key requires explicit VAPID_PUBLIC_KEY
  if (!explicitPublic) {
    console.error(
      "[Push] Raw VAPID_PRIVATE_KEY provided without VAPID_PUBLIC_KEY; cannot construct VAPID credentials."
    );
    return null;
  }

  return {
    publicKey: explicitPublic,
    privateKey: rawPrivate,
    subject,
  };
}

function isAllowedPushOrigin(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "focus-timer.sondrelassen.workers.dev" ||
    hostname.endsWith(".sondrelassen.workers.dev")
  ) {
    return true;
  }
  const siteUrl = process.env.SITE_URL?.trim();
  if (siteUrl) {
    try {
      const site = new URL(siteUrl);
      if (site.protocol === "https:" && site.origin === url.origin) {
        return true;
      }
    } catch {
      // Ignore malformed SITE_URL
    }
  }
  return false;
}

function resolveAppOrigin(subOrigin?: string): string {
  for (const candidate of [subOrigin, process.env.SITE_URL, DEFAULT_APP_ORIGIN]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate.trim());
      if (isAllowedPushOrigin(url)) {
        return url.origin;
      }
    } catch {
      // Try next fallback
    }
  }
  return DEFAULT_APP_ORIGIN;
}

function getCompletionCopy(sessionType: "WORK" | "SHORT_BREAK" | "LONG_BREAK") {
  if (sessionType === "WORK") {
    return {
      title: "Pomodor — Focus session complete",
      body: "Your focus timer has finished. Time for a break.",
    };
  }
  return {
    title: "Pomodor — Break session complete",
    body: "Your break timer has finished. Time for a focus session.",
  };
}

function shouldPruneOnError(status: number, bodyText: string): boolean {
  if (status === 404 || status === 410) return true;
  if (status === 400 || status === 401 || status === 403) {
    const lower = bodyText.toLowerCase();
    return PERMANENT_ERROR_REASONS.some((reason) => lower.includes(reason));
  }
  return false;
}

function parseRetryDelayMs(retryAfterHeader: string | null): number {
  if (!retryAfterHeader) return TRANSIENT_RETRY_DELAY_MS;
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(200, Math.round(seconds * 1000)));
  }
  const dateMs = Date.parse(retryAfterHeader);
  if (Number.isFinite(dateMs)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(200, dateMs - Date.now()));
  }
  return TRANSIENT_RETRY_DELAY_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(
  endpoint: string,
  headers: Record<string, string>,
  body: Uint8Array
): Promise<Response> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: body as BodyInit,
        redirect: "error",
        signal: AbortSignal.timeout(PUSH_FETCH_TIMEOUT_MS),
      });

      const isTransient = response.status === 429 || response.status >= 500;
      if (!isTransient || attempt === maxAttempts) {
        return response;
      }

      const backoffMs = Math.min(
        MAX_RETRY_AFTER_MS,
        TRANSIENT_RETRY_DELAY_MS * Math.pow(3, attempt - 1)
      );
      const delayMs =
        response.status === 429
          ? parseRetryDelayMs(response.headers.get("retry-after"))
          : backoffMs;
      // Drain body before retrying to release connection resources cleanly
      await response.text().catch(() => "");
      await sleep(delayMs);
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) {
        throw err;
      }
      const backoffMs = Math.min(
        MAX_RETRY_AFTER_MS,
        TRANSIENT_RETRY_DELAY_MS * Math.pow(3, attempt - 1)
      );
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Push fetch failed");
}

const pushDispatchResultValidator = v.union(
  v.object({
    sent: v.number(),
    skipped: v.union(v.literal("missing_vapid_key"), v.literal("no_subscriptions")),
  }),
  v.object({
    sent: v.number(),
    pruned: v.number(),
  })
);

async function dispatchPushToSubscriptions(
  ctx: ActionCtx,
  params: {
    userId: Id<"users">;
    buildPayload: (appOrigin: string, silent: boolean) => DeclarativePushPayload;
    options: { ttl: number; urgency: "high"; topic: string };
  }
) {
  const vapid = resolveVapidCredentials();
  if (!vapid) {
    return { sent: 0, skipped: "missing_vapid_key" as const };
  }

  const dispatchCtx = await ctx.runQuery(internal.push.getPushDispatchContext, {
    userId: params.userId,
  });

  if (dispatchCtx.subscriptions.length === 0) {
    return { sent: 0, skipped: "no_subscriptions" as const };
  }

  let sent = 0;
  let pruned = 0;

  await Promise.allSettled(
    dispatchCtx.subscriptions.map(async (sub: Doc<"push_subscriptions">) => {
      const appOrigin = resolveAppOrigin(sub.origin);
      // Keep mobile OS push notifications audible so muting the desktop in-app chime
      // never suppresses phone vibration/sound or smartwatch alerts (the phone's OS silent/DND
      // mode controls mobile notification audio).
      const effectiveSilent = sub.isMobile ? false : !dispatchCtx.soundEnabled;
      let req: webPush.RequestDetails;

      try {
        req = webPush.generateRequestDetails(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          JSON.stringify(params.buildPayload(appOrigin, effectiveSilent)),
          {
            vapidDetails: {
              subject: vapid.subject,
              publicKey: vapid.publicKey,
              privateKey: vapid.privateKey,
            },
            TTL: params.options.ttl,
            urgency: params.options.urgency,
            topic: params.options.topic,
            contentEncoding: "aes128gcm",
          }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const lower = msg.toLowerCase();
        const isVapidConfigError = lower.includes("vapid");
        const isSubscriberKeyError =
          !isVapidConfigError &&
          (lower.includes("p256dh") ||
            lower.includes("auth") ||
            lower.includes("public key") ||
            lower.includes("curve") ||
            lower.includes("subscription") ||
            lower.includes("endpoint"));

        if (isSubscriberKeyError) {
          console.warn(
            `[Push] Invalid subscription cryptography for device ${sub.deviceId}; pruning:`,
            msg
          );
          const deleted = await ctx.runMutation(internal.push.deleteSubscriptionById, {
            id: sub._id,
            expectedEndpoint: sub.endpoint,
            expectedP256dh: sub.p256dh,
          });
          if (deleted) pruned++;
        } else {
          console.error(
            `[Push] Failed to build push request for device ${sub.deviceId}:`,
            msg
          );
        }
        return;
      }

      try {
        const bodyBytes = req.body ? new Uint8Array(req.body) : new Uint8Array(0);
        const response = await sendWithRetry(req.endpoint, req.headers, bodyBytes);

        if (response.ok) {
          sent++;
          return;
        }

        const errorBody = (await response.text().catch(() => "")).slice(0, 300);
        if (shouldPruneOnError(response.status, errorBody)) {
          const deleted = await ctx.runMutation(internal.push.deleteSubscriptionById, {
            id: sub._id,
            expectedEndpoint: sub.endpoint,
            expectedP256dh: sub.p256dh,
          });
          if (deleted) {
            pruned++;
            console.info(
              `[Push] Pruned dead subscription (${response.status}) for device ${sub.deviceId}${errorBody ? `: ${errorBody}` : ""}`
            );
          }
        } else {
          console.warn(
            `[Push] Failed delivery (${response.status}) for device ${sub.deviceId}${errorBody ? `: ${errorBody}` : ""}`
          );
        }
      } catch (err) {
        console.warn(`[Push] Dispatch error for device ${sub.deviceId}:`, err);
      }
    })
  );

  return { sent, pruned };
}

export const sendTimerCompletionPush = internalAction({
  args: {
    userId: v.id("users"),
    sessionType: v.union(
      v.literal("WORK"),
      v.literal("SHORT_BREAK"),
      v.literal("LONG_BREAK")
    ),
    timerRunId: v.string(),
    completedAtMs: v.number(),
  },
  returns: pushDispatchResultValidator,
  handler: async (ctx, args) => {
    const { title, body } = getCompletionCopy(args.sessionType);
    const completedTimestamp = Math.round(args.completedAtMs);

    return dispatchPushToSubscriptions(ctx, {
      userId: args.userId,
      buildPayload: (appOrigin, silent) => ({
        web_push: 8030,
        notification: {
          title,
          body,
          navigate: `${appOrigin}/`,
          icon: `${appOrigin}/icon-192.png`,
          badge: `${appOrigin}/badge-72.png`,
          tag: `pomodor-session-${args.timerRunId}`,
          silent,
          mutable: false,
          timestamp: completedTimestamp,
        },
      }),
      options: {
        ttl: 180,
        urgency: "high",
        topic: "pomodor-alert",
      },
    });
  },
});

export const sendTestPush = internalAction({
  args: {
    userId: v.id("users"),
    scheduledAtMs: v.number(),
  },
  returns: pushDispatchResultValidator,
  handler: async (ctx, args) => {
    return dispatchPushToSubscriptions(ctx, {
      userId: args.userId,
      buildPayload: (appOrigin, silent) => ({
        web_push: 8030,
        notification: {
          title: "Pomodor — Test push alert",
          body: "Background & lock-screen push notifications are active.",
          navigate: `${appOrigin}/`,
          icon: `${appOrigin}/icon-192.png`,
          badge: `${appOrigin}/badge-72.png`,
          tag: `pomodor-test-${Math.round(args.scheduledAtMs)}`,
          silent,
          mutable: false,
          timestamp: Date.now(),
        },
      }),
      options: {
        ttl: 120,
        urgency: "high",
        topic: "pomodor-test",
      },
    });
  },
});

