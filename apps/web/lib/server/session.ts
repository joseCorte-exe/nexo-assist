import { type Person, role } from "@nexo/shared";
import { z } from "zod";

// The session lives only in a signed cookie (ARQUITETURA.md, section 6): no table, nothing to clean up.
// Web Crypto keeps this module usable both in route handlers and in the proxy.

export const SESSION_COOKIE = "nexo_session";

const HOUR_S = 60 * 60;
const REMEMBER_S = 30 * 24 * HOUR_S;
// Without "remember", the cookie dies with the browser. The signed expiry still ends it after 12 hours,
// for browsers that restore session cookies.
const BROWSER_SESSION_S = 12 * HOUR_S;

const sessionSchema = z.object({
  id: z.string().min(1),
  role,
  name: z.string(),
  email: z.string(),
  /** Unix time in seconds. */
  exp: z.number().int(),
});
export type Session = z.infer<typeof sessionSchema>;

const sessionSecret = z.string().min(16, "SESSION_SECRET must have at least 16 characters");

/** The one place that reads the secret. It lives here so the proxy does not load the other server dependencies. */
export function getSessionSecret(): string {
  return sessionSecret.parse(process.env.SESSION_SECRET);
}

/** The part of a person the session carries: enough for the sidebar and to find them again. */
export type SessionPerson = Pick<Person, "id" | "role" | "name" | "email">;

export function createSession(person: SessionPerson, { remember, now }: { remember: boolean; now: Date }): Session {
  const lifetime = remember ? REMEMBER_S : BROWSER_SESSION_S;
  const { id, role, name, email } = person;
  return { id, role, name, email, exp: Math.floor(now.getTime() / 1000) + lifetime };
}

export async function signSession(session: Session, secret: string): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(session)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The session in the token, or null when it is malformed, forged or expired. Never throws. */
export async function verifySession(token: string, secret: string, now: Date): Promise<Session | null> {
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;

  const signatureBytes = fromBase64Url(signature);
  const payloadBytes = fromBase64Url(payload);
  if (!signatureBytes || !payloadBytes) return null;

  // crypto.subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signatureBytes,
    new TextEncoder().encode(payload),
  );
  if (!valid) return null;

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  const parsed = sessionSchema.safeParse(json);
  if (!parsed.success || parsed.data.exp * 1000 <= now.getTime()) return null;
  return parsed.data;
}

/** The session in a cookie value that may be missing. Proxy, pages and API routes all read it through here. */
export function sessionFrom(token: string | undefined, secret: string, now: Date): Promise<Session | null> {
  return token ? verifySession(token, secret, now) : Promise.resolve(null);
}

export function sessionCookieOptions({ remember, secure }: { remember: boolean; secure: boolean }) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    ...(remember ? { maxAge: REMEMBER_S } : {}),
  };
}

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string) {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    keys.set(secret, key);
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[\w-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
