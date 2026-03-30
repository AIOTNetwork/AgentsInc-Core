import type { Request, RequestHandler } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { toNodeHandler } from "better-auth/node";
import Mailgun from "mailgun.js";
import FormData from "form-data";
import type { Db } from "@paperclipai/db";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "@paperclipai/db";
import type { Config } from "../config.js";
import { isDemoEmail } from "../instance-admin-emails.js";

/** Stores captured magic link URLs for demo emails (keyed by lowercase email). */
const demoMagicLinkUrls = new Map<string, string>();

/** Retrieve and remove the stored magic link URL for a demo email. */
export function takeDemoMagicLinkUrl(email: string): string | null {
  const key = email.toLowerCase();
  const url = demoMagicLinkUrls.get(key);
  if (url) demoMagicLinkUrls.delete(key);
  return url ?? null;
}

export type BetterAuthSessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export type BetterAuthSessionResult = {
  session: { id: string; userId: string } | null;
  user: BetterAuthSessionUser | null;
};

type BetterAuthInstance = ReturnType<typeof betterAuth>;

function headersFromNodeHeaders(rawHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(rawHeaders)) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value);
      continue;
    }
    headers.set(key, raw);
  }
  return headers;
}

function headersFromExpressRequest(req: Request): Headers {
  return headersFromNodeHeaders(req.headers);
}

export function deriveAuthTrustedOrigins(config: Config): string[] {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const trustedOrigins = new Set<string>();

  if (baseUrl) {
    try {
      trustedOrigins.add(new URL(baseUrl).origin);
    } catch {
      // Better Auth will surface invalid base URL separately.
    }
  }
  if (config.deploymentMode === "authenticated") {
    for (const hostname of config.allowedHostnames) {
      const trimmed = hostname.trim().toLowerCase();
      if (!trimmed) continue;
      trustedOrigins.add(`https://${trimmed}`);
      trustedOrigins.add(`http://${trimmed}`);
    }
  }


  return Array.from(trustedOrigins);
}

export function createBetterAuthInstance(db: Db, config: Config, trustedOrigins?: string[]): BetterAuthInstance {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.PAPERCLIP_AGENT_JWT_SECRET ?? "paperclip-dev-secret";
  const effectiveTrustedOrigins = trustedOrigins ?? deriveAuthTrustedOrigins(config);

  const publicUrl = process.env.PAPERCLIP_PUBLIC_URL ?? baseUrl;
  const isHttpOnly = publicUrl ? publicUrl.startsWith("http://") : false;

  const mailgunApiKey = process.env.MAILGUN_API_KEY;
  const mailgunDomain = process.env.MAILGUN_DOMAIN;
  const emailFrom = process.env.MAILGUN_FROM_EMAIL ?? "AgentsInc <noreply@agentsinc.ai>";
  const hasGoogle = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const hasGithub = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  const hasMagicLink = !!(mailgunApiKey && mailgunDomain);
  // Keep email+password as fallback when no other auth methods are configured
  const hasAnyNewMethod = hasMagicLink || hasGoogle || hasGithub;

  const authConfig = {
    baseURL: baseUrl,
    secret,
    trustedOrigins: effectiveTrustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: !hasAnyNewMethod,
      requireEmailVerification: false,
      disableSignUp: config.authDisableSignUp,
    },
    socialProviders: {
      ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
        : {}),
      ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
        ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
        : {}),
    },
    plugins: [
      ...(hasMagicLink
        ? [
          magicLink({
            sendMagicLink: async ({ email, url: rawUrl }: { email: string; url: string }, ctx: any) => {
              // Rewrite the verification URL origin to match the requester's origin
              // so the magic link goes through the same proxy (e.g. Office's Caddy)
              // and the session cookie is set on the correct domain.
              // X-Forwarded-Origin is set by Caddy before it rewrites Origin for CSRF.
              let url = rawUrl;
              try {
                const reqOrigin =
                  ctx?.headers?.get?.("x-forwarded-origin") ||
                  ctx?.headers?.get?.("origin") ||
                  (ctx?.headers?.get?.("referer") ? new URL(ctx.headers.get("referer")).origin : null);
                if (reqOrigin && reqOrigin !== new URL(rawUrl).origin) {
                  const parsed = new URL(rawUrl);
                  const originUrl = new URL(reqOrigin);
                  parsed.protocol = originUrl.protocol;
                  parsed.host = originUrl.host;
                  url = parsed.toString();
                }
              } catch {
                // Fallback to original URL
              }
              // For demo emails, capture the rewritten URL instead of sending an email
              if (isDemoEmail(email)) {
                demoMagicLinkUrls.set(email.toLowerCase(), url);
                return;
              }
              const mg = new Mailgun(FormData);
              const client = mg.client({
                username: "api",
                key: mailgunApiKey!,
                ...(process.env.MAILGUN_API_URL ? { url: process.env.MAILGUN_API_URL } : {}),
              });
              await client.messages.create(mailgunDomain!, {
                from: emailFrom,
                to: [email],
                subject: "Your AgentsInc sign-in link ✨",
                html: [
                  `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`,
                  `<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">`,
                  `<div style="max-width:480px;margin:0 auto;padding:48px 24px">`,
                  `<div style="text-align:center;margin-bottom:32px">`,
                  `<span style="font-size:28px">📎</span>`,
                  `<h1 style="color:#e2e8f0;font-size:20px;font-weight:600;margin:12px 0 4px">AgentsInc</h1>`,
                  `</div>`,
                  `<div style="background:#12121a;border:1px solid #1e1e2e;border-radius:12px;padding:32px 24px;text-align:center">`,
                  `<p style="color:#e2e8f0;font-size:16px;font-weight:500;margin:0 0 8px">Your team is waiting 🚀</p>`,
                  `<p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 24px">`,
                  `Click below to sign in and get back to building with your AI agents. No password needed — this link is your key.`,
                  `</p>`,
                  `<a href="${url}" style="display:inline-block;background:#5b8dea;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px;letter-spacing:0.3px">`,
                  `Sign in to AgentsInc`,
                  `</a>`,
                  `<p style="color:#475569;font-size:12px;margin:20px 0 0;line-height:1.5">`,
                  `This link expires in 10 minutes and can only be used once.<br>If you didn't request this, you can safely ignore it.`,
                  `</p>`,
                  `</div>`,
                  `<p style="color:#334155;font-size:11px;text-align:center;margin-top:24px">`,
                  `AgentsInc — Your AI workforce, managed.`,
                  `</p>`,
                  `</div></body></html>`,
                ].join("\n"),
              });
            },
            expiresIn: 600, // 10 minutes
            disableSignUp: config.authDisableSignUp,
          }),
        ]
        : []),
    ],
    ...(isHttpOnly ? { advanced: { useSecureCookies: false } } : {}),
  };

  if (!baseUrl) {
    delete (authConfig as { baseURL?: string }).baseURL;
  }

  return betterAuth(authConfig);
}

export function createBetterAuthHandler(auth: BetterAuthInstance): RequestHandler {
  const handler = toNodeHandler(auth);
  return (req, res, next) => {
    void Promise.resolve(handler(req, res)).catch(next);
  };
}

export async function resolveBetterAuthSessionFromHeaders(
  auth: BetterAuthInstance,
  headers: Headers,
): Promise<BetterAuthSessionResult | null> {
  const api = (auth as unknown as { api?: { getSession?: (input: unknown) => Promise<unknown> } }).api;
  if (!api?.getSession) return null;

  const sessionValue = await api.getSession({
    headers,
  });
  if (!sessionValue || typeof sessionValue !== "object") return null;

  const value = sessionValue as {
    session?: { id?: string; userId?: string } | null;
    user?: { id?: string; email?: string | null; name?: string | null } | null;
  };
  const session = value.session?.id && value.session.userId
    ? { id: value.session.id, userId: value.session.userId }
    : null;
  const user = value.user?.id
    ? {
      id: value.user.id,
      email: value.user.email ?? null,
      name: value.user.name ?? null,
    }
    : null;

  if (!session || !user) return null;
  return { session, user };
}

export async function resolveBetterAuthSession(
  auth: BetterAuthInstance,
  req: Request,
): Promise<BetterAuthSessionResult | null> {
  return resolveBetterAuthSessionFromHeaders(auth, headersFromExpressRequest(req));
}
