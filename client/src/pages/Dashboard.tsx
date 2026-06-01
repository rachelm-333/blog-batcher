import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Loader2, ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const STAGES = [
  { id: 1, label: "Business Profile", description: "Website scan, brand voice, services" },
  { id: 2, label: "Blog Architecture", description: "Pack size, content hierarchy" },
  { id: 3, label: "Keyword Research", description: "Primary keywords, PAA questions" },
  { id: 4, label: "Article Generation", description: "AI-written, SEO-optimised articles" },
  { id: 5, label: "Review & Publish", description: "Edit, approve, schedule, export" },
];

export default function Dashboard() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: user, isLoading: userLoading } = trpc.auth.me.useQuery();
  const { data: business, isLoading: bizLoading } = trpc.business.get.useQuery(undefined, {
    enabled: !!user,
  });

  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/login");
    },
  });

  // Auth guard
  useEffect(() => {
    if (!userLoading && !user) {
      navigate("/login");
    }
  }, [user, userLoading, navigate]);

  // If no business profile yet, redirect to onboarding
  useEffect(() => {
    if (!userLoading && !bizLoading && user && !business) {
      navigate("/onboarding");
    }
  }, [user, business, userLoading, bizLoading, navigate]);

  if (userLoading || bizLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return null;

  const currentStage = business?.currentStage ?? 1;

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
              <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                Admin
              </span>
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

      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* Business header */}
        {business && (
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900">{business.name}</h1>
            <p className="text-slate-500 text-sm mt-1">
              {business.industry ?? ""}
              {business.location ? ` · ${business.location}` : ""}
            </p>
          </div>
        )}

        {/* Stage pipeline */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-6">Your Blog Batcher Pipeline</h2>
          <div className="space-y-4">
            {STAGES.map((stage) => {
              const isComplete = currentStage > stage.id;
              const isCurrent = currentStage === stage.id;
              const isLocked = currentStage < stage.id;

              return (
                <div
                  key={stage.id}
                  className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                    isCurrent
                      ? "border-blue-200 bg-blue-50"
                      : isComplete
                      ? "border-emerald-200 bg-emerald-50/50"
                      : "border-slate-200 bg-slate-50/50 opacity-60"
                  }`}
                >
                  <div className="shrink-0">
                    {isComplete ? (
                      <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                    ) : isCurrent ? (
                      <div className="h-6 w-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                        {stage.id}
                      </div>
                    ) : (
                      <Circle className="h-6 w-6 text-slate-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 text-sm">
                      Stage {stage.id}: {stage.label}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{stage.description}</div>
                  </div>
                  {isCurrent && (
                    <Button
                      size="sm"
                      onClick={() => {
                        if (stage.id === 1) navigate("/onboarding");
                        else if (stage.id === 2) navigate("/architecture");
                        else if (stage.id === 3) navigate("/keywords");
                        else toast.info("Coming soon", { description: `Stage ${stage.id}: ${stage.label} is not yet available.` });
                      }}
                      className="shrink-0"
                    >
                      {stage.id === 1 ? "Edit Profile" : "Continue"}
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Account info */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
            Account
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-400 text-xs mb-1">Email</div>
              <div className="font-medium text-slate-800 truncate">{user.email}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs mb-1">Role</div>
              <div className="font-medium text-slate-800 capitalize">{user.role}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs mb-1">Plan</div>
              <div className="font-medium text-slate-800 capitalize">{user.tier ?? "standard"}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs mb-1">Verified</div>
              <div
                className={`font-medium ${user.emailVerified ? "text-emerald-600" : "text-amber-600"}`}
              >
                {user.emailVerified ? "Yes" : "Pending"}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
