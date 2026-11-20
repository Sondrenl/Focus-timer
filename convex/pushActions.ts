"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildPushHTTPRequest } from "@pushforge/builder";
import { isSubscriptionMobile } from "./push";

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

function parsePrivateJwk(raw: string | undefined): JsonWebKey | string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as JsonWebKey;
  } catch {
    return trimmed;
  }
}

async function dispatchPushToSubscriptions(
  ctx: any,
  params: {
    userId: any;
    requireNotificationsEnabled: boolean;
    buildPayload: (isMobileSub: boolean) => Record<string, string | number | boolean>;
    options: { ttl: number; urgency: "high"; topic: string };
  }
) {
  const privateJWK = parsePrivateJwk(process.env.VAPID_PRIVATE_KEY);
  if (!privateJWK) {
    return { sent: 0, skipped: "missing_vapid_key" as const };
  }

  const adminContact =
    process.env.VAPID_SUBJECT?.trim() || "mailto:notifications@pomodor.app";

  const dispatchCtx = await ctx.runQuery(internal.push.getPushDispatchContext, {
    userId: params.userId,
  });

  if (params.requireNotificationsEnabled && !dispatchCtx.notificationsEnabled) {
    return { sent: 0, skipped: "notifications_disabled" as const };
  }

  if (dispatchCtx.subscriptions.length === 0) {
    return { sent: 0, skipped: "no_subscriptions" as const };
  }

  let sent = 0;
  let pruned = 0;

  await Promise.allSettled(
    dispatchCtx.subscriptions.map(async (sub: any) => {
      const isMobileSub = isSubscriptionMobile(sub);

      try {
        const req = await buildPushHTTPRequest({
          privateJWK,
          subscription: {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          message: {
            payload: params.buildPayload(isMobileSub),
            adminContact,
            options: params.options,
          },
        });

        const response = await fetch(req.endpoint, {
          method: "POST",
          headers: req.headers,
          body: req.body,
        });

        if (response.status === 404 || response.status === 410) {
          await ctx.runMutation(internal.push.deleteSubscriptionById, {
            id: sub._id,
          });
          pruned++;
        } else if (response.ok) {
          sent++;
        } else {
          console.warn(
            `[Push] Failed delivery (${response.status}) for device ${sub.deviceId}`
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
  handler: async (ctx, args) => {
    const { title, body } = getCompletionCopy(args.sessionType);
    return dispatchPushToSubscriptions(ctx, {
      userId: args.userId,
      requireNotificationsEnabled: true,
      buildPayload: (isMobileSub) => ({
        title,
        body,
        sessionId: args.timerRunId,
        sessionType: args.sessionType,
        completedAtMs: args.completedAtMs,
        isMobile: isMobileSub,
      }),
      options: {
        ttl: 600,
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
  handler: async (ctx, args) => {
    return dispatchPushToSubscriptions(ctx, {
      userId: args.userId,
      requireNotificationsEnabled: false,
      buildPayload: (isMobileSub) => ({
        title: "Pomodor — Test push alert",
        body: "Background & lock-screen push notifications are active.",
        sessionId: `test-push-${args.scheduledAtMs}`,
        sessionType: "WORK",
        completedAtMs: Date.now(),
        isTest: true,
        isMobile: isMobileSub,
      }),
      options: {
        ttl: 120,
        urgency: "high",
        topic: "pomodor-test",
      },
    });
  },
});
