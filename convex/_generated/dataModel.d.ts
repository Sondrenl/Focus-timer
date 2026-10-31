import type { GenericDataModel, GenericDocument } from "convex/server";

export type DataModel = GenericDataModel;
export type Doc<TableName extends string> = any;
export type Id<TableName extends string> = string;
