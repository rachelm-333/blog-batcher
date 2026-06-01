import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type CMS = "wordpress" | "wix" | "shopify" | "webflow" | "squarespace" | "ghost";
type WPPlugin = "yoast" | "rankmath" | "aioseo" | "none";

const CMS_OPTIONS: { value: CMS; label: string; description: string }[] = [
  { value: "wordpress", label: "WordPress", description: "Self-hosted or WordPress.com" },
  { value: "wix", label: "Wix", description: "Wix website builder" },
  { value: "shopify", label: "Shopify", description: "E-commerce platform" },
  { value: "webflow", label: "Webflow", description: "Visual web development" },
  { value: "squarespace", label: "Squarespace", description: "All-in-one website builder" },
  { value: "ghost", label: "Ghost", description: "Publishing platform for creators" },
];

const WP_PLUGINS: { value: WPPlugin; label: string; description: string }[] = [
  { value: "yoast", label: "Yoast SEO", description: "Most popular WordPress SEO plugin" },
  { value: "rankmath", label: "RankMath", description: "Feature-rich SEO plugin" },
  { value: "aioseo", label: "All in One SEO", description: "AIOSEO plugin" },
  { value: "none", label: "No SEO Plugin", description: "Write meta fields as standard post meta" },
];

interface Props {
  businessId: number;
  initial: {
    cmsPlatform?: CMS;
    wordpressSeoPlugin?: WPPlugin;
  };
  onNext: () => void;
  onBack: () => void;
}

export default function Step6PublishingPlatform({ businessId, initial, onNext, onBack }: Props) {
  const [cms, setCms] = useState<CMS | undefined>(initial.cmsPlatform);
  const [wpPlugin, setWpPlugin] = useState<WPPlugin | undefined>(initial.wordpressSeoPlugin);

  const updateBusiness = trpc.business.update.useMutation();

  const handleSave = async () => {
    try {
      await updateBusiness.mutateAsync({
        businessId,
        cmsPlatform: cms,
        wordpressSeoPlugin: cms === "wordpress" ? wpPlugin : undefined,
      });
      toast.success("Publishing platform saved.");
      onNext();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save.");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Publishing Platform</h2>
        <p className="text-muted-foreground">
          Select the CMS you publish to. This sets the default for every article generated and
          determines how Blog Batcher connects to your site.
        </p>
      </div>

      <div className="space-y-3">
        <Label className="text-base font-medium">Your CMS</Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {CMS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setCms(option.value)}
              className={cn(
                "text-left border rounded-lg p-4 transition-all",
                cms === option.value
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-primary/50"
              )}
            >
              <div className="font-medium text-sm">{option.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{option.description}</div>
            </button>
          ))}
        </div>
      </div>

      {cms === "wordpress" && (
        <div className="space-y-3">
          <Label className="text-base font-medium">WordPress SEO Plugin</Label>
          <p className="text-sm text-muted-foreground -mt-2">
            Blog Batcher writes the focus keyword to the correct meta field for your plugin.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {WP_PLUGINS.map((plugin) => (
              <button
                key={plugin.value}
                type="button"
                onClick={() => setWpPlugin(plugin.value)}
                className={cn(
                  "text-left border rounded-lg p-4 transition-all",
                  wpPlugin === plugin.value
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div className="font-medium text-sm">{plugin.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{plugin.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!cms && (
        <p className="text-sm text-muted-foreground">
          You can skip this step and set your publishing platform later in Settings.
        </p>
      )}

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleSave} disabled={updateBusiness.isPending}>
          {updateBusiness.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {cms ? "Save & Continue" : "Skip & Continue"}
        </Button>
      </div>
    </div>
  );
}
