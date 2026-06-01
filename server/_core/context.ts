import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import { eq } from "drizzle-orm";
import type { User } from "../../drizzle/schema";
import { users } from "../../drizzle/schema";
import { getDb } from "../db";
import { verifySessionToken } from "./session";
import { sdk } from "./sdk";
import { COOKIE_NAME } from "../../shared/const";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // 1. Try Blog Batcher email+password JWT (userId in payload)
  try {
    const cookieHeader = opts.req.headers.cookie ?? "";
    const cookies = parseCookieHeader(cookieHeader);
    const sessionCookie = cookies[COOKIE_NAME];
    if (sessionCookie) {
      const payload = await verifySessionToken(sessionCookie);
      if (payload?.userId) {
        const db = await getDb();
        if (db) {
          const [found] = await db
            .select()
            .from(users)
            .where(eq(users.id, payload.userId))
            .limit(1);
          if (found) {
            user = found;
          }
        }
      }
    }
  } catch {
    // fall through to Manus OAuth
  }

  // 2. Fall back to Manus OAuth session (openId in payload)
  if (!user) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch {
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
