import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const forgot = trpc.auth.forgotPassword.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    forgot.mutate({ email });
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="mb-8">
            <Link href="/">
              <span className="text-2xl font-bold text-foreground tracking-tight cursor-pointer">
                Blog <span className="text-primary">Batcher</span>
              </span>
            </Link>
          </div>
          <div className="bg-card rounded-2xl shadow-sm border border-border p-10">
            <div className="w-16 h-16 bg-primary/15 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-3">Check your inbox</h2>
            <p className="text-muted-foreground mb-2">
              If an account exists for <strong className="text-foreground">{email}</strong>, we've sent a password reset link.
            </p>
            <p className="text-muted-foreground text-sm mb-8">
              The link expires in 1 hour. Check your spam folder if you don't see it.
            </p>
            <Link href="/login" className="text-primary font-medium hover:underline text-sm">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/">
            <span className="text-2xl font-bold text-foreground tracking-tight cursor-pointer">
              Blog <span className="text-primary">Batcher</span>
            </span>
          </Link>
          <p className="text-muted-foreground mt-2 text-sm">AI-powered blog articles at scale</p>
        </div>

        <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
          <h1 className="text-xl font-semibold text-foreground mb-1">Reset your password</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Enter your email address and we'll send you a link to reset your password.
          </p>

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
                className="mt-1.5"
              />
            </div>

            <Button
              type="submit"
              className="w-full mt-2"
              disabled={forgot.isPending}
            >
              {forgot.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
              ) : (
                "Send reset link"
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Remembered it?{" "}
            <Link href="/login" className="text-primary font-medium hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
