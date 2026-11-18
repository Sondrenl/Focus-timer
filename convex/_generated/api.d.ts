/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as authHelper from "../authHelper.js";
import type * as coffee from "../coffee.js";
import type * as crons from "../crons.js";
import type * as defaultData from "../defaultData.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as push from "../push.js";
import type * as pushActions from "../pushActions.js";
import type * as sessions from "../sessions.js";
import type * as tags from "../tags.js";
import type * as telemetry from "../telemetry.js";
import type * as telemetryValidators from "../telemetryValidators.js";
import type * as timer from "../timer.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authHelper: typeof authHelper;
  coffee: typeof coffee;
  crons: typeof crons;
  defaultData: typeof defaultData;
  http: typeof http;
  migrations: typeof migrations;
  push: typeof push;
  pushActions: typeof pushActions;
  sessions: typeof sessions;
  tags: typeof tags;
  telemetry: typeof telemetry;
  telemetryValidators: typeof telemetryValidators;
  timer: typeof timer;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
