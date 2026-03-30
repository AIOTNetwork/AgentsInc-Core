import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi, type AuthConfig } from "../api/auth";
import { setBoardToken, getBoardToken } from "../api/client";
import { healthApi } from "../api/health";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { AsciiArtAnimation } from "@/components/AsciiArtAnimation";
import { Sparkles } from "lucide-react";

type AuthState = "email_input" | "email_sent";

export function AuthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [authState, setAuthState] = useState<AuthState>("email_input");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(false);
  const exchangeAttempted = useRef(false);

  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);

  // In local_trusted mode, no auth needed — redirect to home
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });

  useEffect(() => {
    if (healthQuery.data && healthQuery.data.deploymentMode !== "authenticated") {
      navigate(nextPath, { replace: true });
    }
  }, [healthQuery.data, navigate, nextPath]);

  // Fetch auth config to know which methods are available
  const configQuery = useQuery({
    queryKey: ["auth-config"],
    queryFn: () => authApi.getAuthConfig(),
  });

  // Check for existing session (e.g. user returning from OAuth/magic link)
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  // If session found but no board token, exchange for key then navigate
  useEffect(() => {
    if (sessionQuery.data && !getBoardToken() && !exchanging && !exchangeAttempted.current) {
      exchangeAttempted.current = true;
      setExchanging(true);
      authApi
        .exchangeSessionForKey()
        .then((result) => {
          setBoardToken(result.token);
          queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
          queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
          navigate(nextPath, { replace: true });
        })
        .catch(() => {
          setExchanging(false);
          // Silent — this auto-exchange on mount can fail if the session is stale or invalid
        });
    } else if (sessionQuery.data && getBoardToken()) {
      navigate(nextPath, { replace: true });
    }
  }, [sessionQuery.data, exchanging, navigate, nextPath, queryClient]);

  // Demo login mutation (instant sign-in for configured demo emails)
  const demoLoginMutation = useMutation({
    mutationFn: async () => {
      return authApi.demoLogin({ email: email.trim(), callbackURL: nextPath });
    },
    onSuccess: (url) => {
      setError(null);
      // Navigate to the magic link verification URL — better-auth will set
      // proper signed session cookies and redirect to the callbackURL.
      window.location.href = url;
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Demo login failed");
    },
  });

  // Magic link mutation
  const magicLinkMutation = useMutation({
    mutationFn: async () => {
      await authApi.sendMagicLink({
        email: email.trim(),
        callbackURL: nextPath,
      });
    },
    onSuccess: () => {
      setError(null);
      setAuthState("email_sent");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to send magic link");
    },
  });

  // Social sign-in mutation
  const socialMutation = useMutation({
    mutationFn: async (provider: "google" | "github") => {
      await authApi.signInSocial({
        provider,
        callbackURL: nextPath,
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to start social sign-in");
    },
  });

  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const config: AuthConfig | null = configQuery.data ?? null;
  const hasAnyMethod = config ? config.magicLink || config.google || config.github || config.emailPassword : false;
  const hasSocial = config ? config.google || config.github : false;
  const demoEmailSet = useMemo(
    () => new Set((config?.demoEmails ?? []).map((e) => e.toLowerCase())),
    [config?.demoEmails],
  );
  const isDemo = demoEmailSet.has(email.trim().toLowerCase());
  const isPending = magicLinkMutation.isPending || socialMutation.isPending || demoLoginMutation.isPending;

  // Email+password fallback mutation
  const emailPasswordMutation = useMutation({
    mutationFn: async () => {
      if (mode === "sign_in") {
        await authApi.signInEmail({ email: email.trim(), password });
      } else {
        await authApi.signUpEmail({ name: name.trim(), email: email.trim(), password });
      }
    },
    onSuccess: async () => {
      setError(null);
      // Session cookie is set — exchange for board key
      exchangeAttempted.current = false;
      const result = await authApi.exchangeSessionForKey();
      setBoardToken(result.token);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      navigate(nextPath, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Authentication failed");
    },
  });

  const canSubmitPassword =
    email.trim().length > 0 &&
    password.trim().length > 0 &&
    (mode === "sign_in" || (name.trim().length > 0 && password.trim().length >= 8));

  if (sessionQuery.isLoading || exchanging) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex bg-background">
      {/* Left half -- form */}
      <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
        <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
          <div className="flex items-center gap-2 mb-8">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">AgentsInc</span>
          </div>

          {authState === "email_input" && (
            <>
              <h1 className="text-xl font-semibold">
                {config?.emailPassword
                  ? (mode === "sign_in" ? "Welcome back" : "Join AgentsInc")
                  : "Sign in to AgentsInc"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {config?.emailPassword
                  ? (mode === "sign_in"
                    ? "Your AI agents missed you. Let's get back to work."
                    : "Build your AI workforce in minutes.")
                  : "Enter your email and we'll send you a magic link. No passwords, no friction."}
              </p>

              {configQuery.isLoading && (
                <p className="mt-6 text-sm text-muted-foreground">Loading sign-in options...</p>
              )}

              {config && !hasAnyMethod && (
                <p className="mt-6 text-sm text-destructive">
                  No authentication methods are configured for this instance. Please contact your administrator.
                </p>
              )}

              {config && hasAnyMethod && (
                <div className="mt-6 space-y-4">
                  {/* Email+Password fallback (when no magic link / OAuth configured) */}
                  {config.emailPassword && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (emailPasswordMutation.isPending || !canSubmitPassword) return;
                        emailPasswordMutation.mutate();
                      }}
                    >
                      <div className="space-y-4">
                        {mode === "sign_up" && (
                          <div>
                            <label htmlFor="name" className="text-xs text-muted-foreground mb-1 block">Name</label>
                            <input
                              id="name"
                              name="name"
                              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                              value={name}
                              onChange={(event) => setName(event.target.value)}
                              autoComplete="name"
                              autoFocus
                            />
                          </div>
                        )}
                        <div>
                          <label htmlFor="email" className="text-xs text-muted-foreground mb-1 block">Email</label>
                          <input
                            id="email"
                            name="email"
                            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            autoComplete="email"
                            autoFocus={mode === "sign_in"}
                          />
                        </div>
                        <div>
                          <label htmlFor="password" className="text-xs text-muted-foreground mb-1 block">Password</label>
                          <input
                            id="password"
                            name="password"
                            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
                          />
                        </div>
                        <Button
                          type="submit"
                          disabled={emailPasswordMutation.isPending}
                          aria-disabled={!canSubmitPassword || emailPasswordMutation.isPending}
                          className={`w-full ${!canSubmitPassword && !emailPasswordMutation.isPending ? "opacity-50" : ""}`}
                        >
                          {emailPasswordMutation.isPending
                            ? "Working..."
                            : mode === "sign_in"
                              ? "Sign In"
                              : "Create Account"}
                        </Button>
                      </div>
                    </form>
                  )}

                  {/* Magic link email form */}
                  {config.magicLink && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (isPending || !email.trim()) return;
                        if (isDemo) {
                          demoLoginMutation.mutate();
                        } else {
                          magicLinkMutation.mutate();
                        }
                      }}
                    >
                      <div className="space-y-4">
                        <div>
                          <label htmlFor="email" className="text-xs text-muted-foreground mb-1 block">
                            Email
                          </label>
                          <input
                            id="email"
                            name="email"
                            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            autoComplete="email"
                            autoFocus
                            placeholder="you@example.com"
                          />
                        </div>
                        <Button
                          type="submit"
                          disabled={isPending || !email.trim()}
                          className="w-full"
                        >
                          {(magicLinkMutation.isPending || demoLoginMutation.isPending)
                            ? (isDemo ? "Signing in..." : "Sending...")
                            : (isDemo ? "Demo Sign In" : "Continue with Email")}
                        </Button>
                      </div>
                    </form>
                  )}

                  {(config.magicLink || config.emailPassword) && hasSocial && (
                    <div className="relative flex items-center justify-center">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border" />
                      </div>
                      <span className="relative bg-background px-3 text-xs text-muted-foreground">
                        or continue with
                      </span>
                    </div>
                  )}

                  {config.google && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isPending}
                      className="w-full"
                      onClick={() => socialMutation.mutate("google")}
                    >
                      {socialMutation.isPending ? "Redirecting..." : "Continue with Google"}
                    </Button>
                  )}

                  {config.github && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isPending}
                      className="w-full"
                      onClick={() => socialMutation.mutate("github")}
                    >
                      {socialMutation.isPending ? "Redirecting..." : "Continue with GitHub"}
                    </Button>
                  )}
                </div>
              )}

              {error && <p className="mt-4 text-xs text-destructive">{error}</p>}

              {config?.emailPassword && (
                <div className="mt-5 text-sm text-muted-foreground">
                  {mode === "sign_in" ? "Need an account?" : "Already have an account?"}{" "}
                  <button
                    type="button"
                    className="font-medium text-foreground underline underline-offset-2"
                    onClick={() => {
                      setError(null);
                      setMode(mode === "sign_in" ? "sign_up" : "sign_in");
                    }}
                  >
                    {mode === "sign_in" ? "Create one" : "Sign in"}
                  </button>
                </div>
              )}
            </>
          )}

          {authState === "email_sent" && (
            <>
              <h1 className="text-xl font-semibold">Check your inbox ✉️</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                We just sent a magic link to <span className="font-medium text-foreground">{email}</span>.
                Click it and you're in — no password needed.
              </p>

              <div className="mt-6 space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={magicLinkMutation.isPending}
                  className="w-full"
                  onClick={() => magicLinkMutation.mutate()}
                >
                  {magicLinkMutation.isPending ? "Sending..." : "Resend"}
                </Button>

                <button
                  type="button"
                  className="block w-full text-center text-sm text-muted-foreground underline underline-offset-2"
                  onClick={() => {
                    setError(null);
                    setAuthState("email_input");
                  }}
                >
                  Use a different email
                </button>
              </div>

              {error && <p className="mt-4 text-xs text-destructive">{error}</p>}
            </>
          )}
        </div>
      </div>

      {/* Right half -- ASCII art animation (hidden on mobile) */}
      <div className="hidden md:block w-1/2 overflow-hidden">
        <AsciiArtAnimation />
      </div>
    </div>
  );
}
