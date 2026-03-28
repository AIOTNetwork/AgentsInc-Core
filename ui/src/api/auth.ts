import { setBoardToken } from "./client";

export type AuthSession = {
  session: { id: string; userId: string };
  user: { id: string; email: string | null; name: string | null };
};

function toSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const sessionValue = record.session;
  const userValue = record.user;
  if (!sessionValue || typeof sessionValue !== "object") return null;
  if (!userValue || typeof userValue !== "object") return null;
  const session = sessionValue as Record<string, unknown>;
  const user = userValue as Record<string, unknown>;
  if (typeof session.id !== "string" || typeof session.userId !== "string") return null;
  if (typeof user.id !== "string") return null;
  return {
    session: { id: session.id, userId: session.userId },
    user: {
      id: user.id,
      email: typeof user.email === "string" ? user.email : null,
      name: typeof user.name === "string" ? user.name : null,
    },
  };
}

async function authPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/auth${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (payload as { error?: { message?: string } | string } | null)?.error &&
      typeof (payload as { error?: { message?: string } | string }).error === "object"
        ? ((payload as { error?: { message?: string } }).error?.message ?? `Request failed: ${res.status}`)
        : (payload as { error?: string } | null)?.error ?? `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return payload;
}

export type AuthConfig = {
  magicLink: boolean;
  google: boolean;
  emailPassword: boolean;
  github: boolean;
};

export const authApi = {
  getSession: async (): Promise<AuthSession | null> => {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = localStorage.getItem("paperclip_board_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const res = await fetch("/api/auth/get-session", {
      credentials: "include",
      headers,
    });
    if (res.status === 401) return null;
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`Failed to load session (${res.status})`);
    }
    const direct = toSession(payload);
    if (direct) return direct;
    const nested = payload && typeof payload === "object" ? toSession((payload as Record<string, unknown>).data) : null;
    return nested;
  },

  signOut: async () => {
    try {
      await authPost("/sign-out", {});
    } catch {
      // Server sign-out may fail if session is already invalid — clear locally regardless
    }
    setBoardToken(null);
  },

  signInEmail: async (input: { email: string; password: string }) => {
    await authPost("/sign-in/email", input);
  },

  signUpEmail: async (input: { name: string; email: string; password: string }) => {
    await authPost("/sign-up/email", input);
  },

  sendMagicLink: async (input: { email: string; callbackURL?: string }) => {
    await authPost("/sign-in/magic-link", {
      email: input.email,
      callbackURL: input.callbackURL ?? "/",
    });
  },

  signInSocial: async (input: { provider: "google" | "github"; callbackURL?: string }) => {
    const res = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: input.provider,
        callbackURL: input.callbackURL ?? "/",
      }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        (payload as { error?: { message?: string } | string } | null)?.error &&
        typeof (payload as { error?: { message?: string } | string }).error === "object"
          ? ((payload as { error?: { message?: string } }).error?.message ?? `Request failed: ${res.status}`)
          : (payload as { error?: string } | null)?.error ?? `Request failed: ${res.status}`;
      throw new Error(message);
    }
    if (payload?.url) {
      window.location.href = payload.url;
    }
  },

  exchangeSessionForKey: async (): Promise<{ token: string; keyId: string; expiresAt: string }> => {
    const res = await fetch("/api/exchange-session-for-key", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((payload as { error?: string } | null)?.error ?? "Failed to exchange session");
    }
    return payload as { token: string; keyId: string; expiresAt: string };
  },

  getAuthConfig: async (): Promise<AuthConfig> => {
    const res = await fetch("/api/auth-config");
    if (!res.ok) return { magicLink: false, google: false, github: false, emailPassword: true };
    return res.json();
  },
};
