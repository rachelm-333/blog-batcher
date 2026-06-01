import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";

interface Props {
  businessId: number;
  summary: {
    name?: string;
    industry?: string;
    location?: string;
    audienceCount: number;
    serviceCount: number;
    competitorCount: number;
    hasBrandVoice: boolean;
    cmsPlatform?: string;
    yearsInBusiness?: number | null;
  };
  onBack: () => void;
}

export default function Step8Review({ businessId, summary, onBack }: Props) {
  const [, navigate] = useLocation();
  const [saving, setSaving] = useState(false);

  const markStageComplete = trpc.business.markStageComplete.useMutation();

  const handleFinish = async () => {
    setSaving(true);
    try {
      await markStageComplete.mutateAsync({ businessId, completedStage: 1 });
      toast.success("Profile saved! Moving to Stage 2 — Blog Architecture.");
      navigate("/dashboard");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const items: { label: string; value: string; ok: boolean }[] = [
    { label: "Business Name", value: summary.name ?? "—", ok: !!summary.name },
    { label: "Industry", value: summary.industry ?? "Not set", ok: !!summary.industry },
    { label: "Location", value: summary.location ?? "Not set", ok: !!summary.location },
    {
      label: "Target Audiences",
      value: `${summary.audienceCount} group${summary.audienceCount !== 1 ? "s" : ""}`,
      ok: summary.audienceCount > 0,
    },
    {
      label: "Services / Products",
      value: `${summary.serviceCount} item${summary.serviceCount !== 1 ? "s" : ""}`,
      ok: summary.serviceCount > 0,
    },
    {
      label: "Brand Voice",
      value: summary.hasBrandVoice ? "Configured" : "Not set",
      ok: summary.hasBrandVoice,
    },
    {
      label: "Competitors",
      value:
        summary.competitorCount > 0
          ? `${summary.competitorCount} added`
          : "None (optional)",
      ok: true,
    },
    {
      label: "Publishing Platform",
      value: summary.cmsPlatform
        ? summary.cmsPlatform.charAt(0).toUpperCase() + summary.cmsPlatform.slice(1)
        : "Not set (optional)",
      ok: true,
    },
    {
      label: "Years in Business",
      value: summary.yearsInBusiness ? `${summary.yearsInBusiness} years` : "Not set (optional)",
      ok: true,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Review Your Profile</h2>
        <p className="text-muted-foreground">
          Everything looks good? Click "Save Profile & Continue" to lock in Stage 1 and move to
          Blog Architecture. You can always return to edit your profile later.
        </p>
      </div>

      <div className="border rounded-lg divide-y">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${item.ok ? "text-green-500" : "text-muted-foreground"}`}
              />
              <span className="text-sm font-medium">{item.label}</span>
            </div>
            <span className="text-sm text-muted-foreground">{item.value}</span>
          </div>
        ))}
      </div>

      <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">All fields are editable at any time.</strong> Return to
        Stage 1 from your dashboard to update your profile or re-scan your website.
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleFinish} disabled={saving} size="lg">
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save Profile & Continue →"
          )}
        </Button>
      </div>
    </div>
  );
}
