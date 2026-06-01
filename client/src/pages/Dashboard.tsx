import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useEffect } from "react";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: user, isLoading } = trpc.auth.me.useQuery();

  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/login");
    },
  });

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/login");
    }
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top nav */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold text-slate-900 tracking-tight">
          Blog <span className="text-blue-600">Batcher</span>
        </span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500">
            {user.name ?? user.email}
            {user.role === "admin" && (
              <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Admin</span>
            )}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            {logout.isPending ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-6 py-16 text-center">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12">
          <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-3">
            Welcome, {user.name?.split(" ")[0] ?? "there"}!
          </h1>
          <p className="text-slate-500 text-lg mb-2">
            You're signed in to Blog Batcher.
          </p>
          <p className="text-slate-400 text-sm mb-10">
            Layer 2 Auth is complete. The full 5-stage workflow (Business Profile → Architecture → Keywords → Generation → Review/Publish) will be built in the next layers.
          </p>

          {/* Auth status card */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-6 text-left max-w-sm mx-auto">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Account details</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Email</span>
                <span className="text-slate-800 font-medium">{user.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Role</span>
                <span className="text-slate-800 font-medium capitalize">{user.role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tier</span>
                <span className="text-slate-800 font-medium capitalize">{user.tier ?? "standard"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Email verified</span>
                <span className={user.emailVerified ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>
                  {user.emailVerified ? "Yes" : "No"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
