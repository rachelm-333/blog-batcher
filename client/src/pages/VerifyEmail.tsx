import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";

export default function VerifyEmail() {
  const [location] = useLocation();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  const verify = trpc.auth.verifyEmail.useMutation({
    onSuccess: (data) => {
      setStatus("success");
      setMessage(data.message);
    },
    onError: (err) => {
      setStatus("error");
      setMessage(err.message);
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    setToken(t);
    if (t) {
      verify.mutate({ token: t });
    } else {
      setStatus("error");
      setMessage("No verification token found. Please use the link from your email.");
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {/* Logo */}
        <div className="mb-8">
          <Link href="/">
            <span className="text-2xl font-bold text-slate-900 tracking-tight cursor-pointer">
              Blog <span className="text-blue-600">Batcher</span>
            </span>
          </Link>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10">
          {status === "loading" && (
            <>
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Verifying your email…</h2>
              <p className="text-slate-500 text-sm">Just a moment.</p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-3">Email verified!</h2>
              <p className="text-slate-500 mb-8">{message}</p>
              <Button asChild className="w-full">
                <Link href="/login">Sign in to your account</Link>
              </Button>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-3">Verification failed</h2>
              <p className="text-slate-500 mb-8">{message}</p>
              <div className="space-y-3">
                <Button asChild variant="outline" className="w-full">
                  <Link href="/register">Create a new account</Link>
                </Button>
                <p className="text-sm text-slate-400">
                  Already registered?{" "}
                  <Link href="/login" className="text-blue-600 hover:underline">Sign in</Link>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
