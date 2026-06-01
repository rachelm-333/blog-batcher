/**
 * server/_core/session.ts
 * JWT session token helpers for Blog Batcher email+password auth.
 * Uses jose (already in dependencies) with HS256.
 * Token lifetime: 30 days.
 */
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./env";

const ALG = "HS256";
const EXPIRY = "30d";

function getSecret(): Uint8Array {
  const secret = ENV.cookieSecret;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: number;
  role: string;
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId, role: payload.role })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "number") return null;
    return { userId: payload.userId as number, role: (payload.role as string) ?? "user" };
  } catch {
    return null;
  }
}
