/**
 * Authentication types and token payload definitions.
 */

export interface GoogleJwtPayload {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  exp?: number;
  [key: string]: unknown;
}
