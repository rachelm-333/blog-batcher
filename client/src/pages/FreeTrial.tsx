/**
 * Layer 14 — Free Trial Flow
 *
 * The dedicated free trial page. New users land here to start their free trial.
 * Shows:
 *  - Trial blocked state (already used) with upgrade prompt
 *  - Trial start form (business name + URL)
 *  - Trial in progress (redirects to generation page)
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { CheckCircle, Zap, FileText, Star, ArrowRight, Lock } from "lucide-react";

const TRIAL_FEATURES = [
  "1 full cluster article generated end-to-end",
  "16-point Authority Standard quality check",
  "AI fingerprint scrub (sounds human)",
  "SEO score, meta title, meta description",
  "FAQ schema markup",
  "No credit card required",
];

export default function FreeTrial() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [businessName, setBusinessName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<"trial_complete" | "no_credits" | "trial_blocked">("trial_blocked");

  const { data: trialStatus, isLoading: statusLoading } = trpc.trial.getStatus.useQuery(
    undefined,
    { enabled: !!user }
  );

  const startTrial = trpc.trial.startFreeTrial.useMutation({
    onSuccess: (data) => {
      toast.success("Free trial started! Redirecting to article generation...");
      // Navigate to the generation page for this business
      navigate(`/generate?businessId=${data.businessId}`);
    },
    onError: (err) => {
      if (err.message === "FREE_TRIAL_USED" || err.message?.includes("already used")) {
        setUpgradeReason("trial_blocked");
        setShowUpgrade(true);
      } else {
        toast.error(err.message || "Failed to start free trial");
      }
    },
  });

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessName.trim()) {
      toast.error("Please enter your business name");
      return;
    }
    startTrial.mutate({
      businessName: businessName.trim(),
      websiteUrl: websiteUrl.trim() || undefined,
    });
  };

  if (authLoading || statusLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  if (!user) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
          <Lock className="h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">Please sign in to start your free trial.</p>
          <Button onClick={() => window.location.href = getLoginUrl()}>
            Sign In
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  // Already used trial — show upgrade prompt
  if (trialStatus?.freeTrialUsed && !trialStatus?.hasActivePlan) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl mx-auto py-12 text-center space-y-6">
          <div className="flex flex-col items-center gap-3">
            <div className="h-14 w-14 rounded-full bg-amber-100 flex items-center justify-center">
              <Star className="h-7 w-7 text-amber-500" />
            </div>
            <h1 className="text-2xl font-bold">You've used your free trial</h1>
            <p className="text-muted-foreground max-w-md">
              Your free trial article has been generated. Purchase a plan to unlock the full workflow
              and generate your complete article pack.
            </p>
          </div>
          <Button size="lg" onClick={() => { setUpgradeReason("trial_blocked"); setShowUpgrade(true); }}>
            View Plans <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          {trialStatus?.trialBusinessId && (
            <Button
              variant="outline"
              onClick={() => navigate(`/generate?businessId=${trialStatus.trialBusinessId}`)}
            >
              View my trial article
            </Button>
          )}
        </div>
        <UpgradePrompt open={showUpgrade} onClose={() => setShowUpgrade(false)} reason={upgradeReason} />
      </DashboardLayout>
    );
  }

  // Already has a trial business in progress — redirect
  if (trialStatus?.trialBusinessId && !trialStatus?.freeTrialUsed) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl mx-auto py-12 text-center space-y-6">
          <div className="flex flex-col items-center gap-3">
            <div className="h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center">
              <Zap className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Your trial is in progress</h1>
            <p className="text-muted-foreground">
              Your free trial article is being generated. Click below to check the status.
            </p>
          </div>
          <Button
            size="lg"
            onClick={() => navigate(`/generate?businessId=${trialStatus.trialBusinessId}`)}
          >
            View Generation Progress <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  // New user — show trial start form
  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto py-10 px-4">
        <div className="text-center mb-8 space-y-3">
          <Badge variant="secondary" className="text-xs px-3 py-1">
            Free Trial — No Credit Card Required
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight">
            See Lyynkit in action — for free
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            We'll generate one complete cluster article for your business using our full 16-point
            Authority Standard. No credit card. No commitment.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Feature list */}
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                What you get
              </CardTitle>
              <CardDescription>Your free trial includes:</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5">
                {TRIAL_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Start form */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Start your free trial</CardTitle>
              <CardDescription>
                Enter your business details and we'll generate your article.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleStart} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="businessName">Business name *</Label>
                  <Input
                    id="businessName"
                    placeholder="e.g. Acme Plumbing"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="websiteUrl">Website URL (optional)</Label>
                  <Input
                    id="websiteUrl"
                    type="url"
                    placeholder="https://example.com.au"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Providing your URL helps us tailor the article to your brand voice.
                  </p>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={startTrial.isPending}
                >
                  {startTrial.isPending ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Starting trial...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Generate my free article
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  )}
                </Button>
                <p className="text-xs text-center text-muted-foreground">
                  One free trial per account. No credit card required.
                </p>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      <UpgradePrompt open={showUpgrade} onClose={() => setShowUpgrade(false)} reason={upgradeReason} />
    </DashboardLayout>
  );
}
