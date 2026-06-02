import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { Eye, EyeOff, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

export default function Login() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/dashboard");
    },
    onError: (err) => {
      if (err instanceof TRPCClientError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    login.mutate({ email, password });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/">
            <div className="inline-flex items-center gap-2 cursor-pointer">
              <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-2xl font-bold text-foreground tracking-tight">
                Blog<span className="text-primary">Batcher</span>
              </span>
            </div>
          </Link>
          <p className="text-muted-foreground mt-2 text-sm">AI-powered blog articles at scale</p>
        </div>

        <div className="bg-card rounded-2xl border border-border p-8 shadow-xl">
          <h1 className="text-xl font-semibold text-foreground mb-1">Sign in to your account</h1>
          <p className="text-sm text-muted-foreground mb-6">Welcome back. Enter your details below.</p>

          {error && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-lg px-4 py-3 text-sm mb-5">
              {error}
              {error.includes("verify your email") && (
                <div className="mt-2">
                  <ResendVerificationLink email={email} />
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email" className="text-foreground font-medium">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="jane@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="mt-1.5 bg-background border-border"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-foreground font-medium">Password</Label>
                <Link href="/forgot-password" className="text-xs text-primary hover:text-primary/80 transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative mt-1.5">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pr-10 bg-background border-border"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full mt-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              disabled={login.isPending}
            >
              {login.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in…</>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Don't have an account?{" "}
            <Link href="/register" className="text-primary font-medium hover:text-primary/80 transition-colors">
              Create one free
            </Link>
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          By signing in you agree to our{" "}
          <a href="#" className="text-primary hover:underline">Terms of Service</a>{" "}
          and{" "}
          <a href="#" className="text-primary hover:underline">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

function ResendVerificationLink({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const resend = trpc.auth.resendVerification.useMutation({
    onSuccess: () => setSent(true),
  });

  if (sent) return <span className="text-emerald-600 font-medium text-sm">Verification email sent!</span>;

  return (
    <button
      onClick={() => resend.mutate({ email })}
      disabled={resend.isPending || !email}
      className="text-primary font-medium text-sm hover:underline disabled:opacity-50"
    >
      {resend.isPending ? "Sending…" : "Resend verification email"}
    </button>
  );
}
