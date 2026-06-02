/**
 * UpgradePrompt — shown when:
 *  1. The user's free trial article has been generated (conversion prompt)
 *  2. The user tries to generate a second article without credits (blocked state)
 *  3. The user tries to start a second free trial (abuse prevention)
 *
 * Shows all three plans (Citation Starter, Citation Authority, Credit Top-Up)
 * with Stripe checkout links.
 */
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, Zap, Star, CreditCard, X } from "lucide-react";

interface UpgradePromptProps {
  open: boolean;
  onClose: () => void;
  /** Why the prompt is being shown */
  reason?: "trial_complete" | "no_credits" | "trial_blocked";
}

const PLAN_ICONS: Record<string, React.ReactNode> = {
  citation_starter: <Zap className="h-5 w-5 text-blue-500" />,
  citation_authority: <Star className="h-5 w-5 text-amber-500" />,
  credit_topup: <CreditCard className="h-5 w-5 text-emerald-500" />,
};

const PLAN_COLORS: Record<string, string> = {
  citation_starter: "border-blue-200 bg-blue-50/50",
  citation_authority: "border-amber-200 bg-amber-50/50 ring-2 ring-amber-300",
  credit_topup: "border-emerald-200 bg-emerald-50/50",
};

export function UpgradePrompt({ open, onClose, reason = "trial_complete" }: UpgradePromptProps) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const { data: upgradeOptions, isLoading } = trpc.trial.getUpgradeOptions.useQuery(undefined, {
    enabled: open,
  });

  const createCheckout = trpc.payments.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      toast.info("Redirecting to checkout...");
      window.open(data.checkoutUrl, "_blank");
      setLoadingKey(null);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create checkout session");
      setLoadingKey(null);
    },
  });

  const handlePurchase = (productKey: string) => {
    setLoadingKey(productKey);
    createCheckout.mutate({
      productKey: productKey as "citation_starter" | "citation_authority" | "credit_topup",
      origin: window.location.origin,
    });
  };

  const reasonMessages: Record<string, { title: string; description: string }> = {
    trial_complete: {
      title: "Your free trial article is ready!",
      description:
        "You've seen what Lyynkit can do. Purchase a plan to unlock the full workflow — keyword research, architecture planning, and a complete article pack.",
    },
    no_credits: {
      title: "You need credits to continue",
      description:
        "You've used all your credits. Top up or upgrade to a plan to keep generating articles.",
    },
    trial_blocked: {
      title: "Free trial already used",
      description:
        "Each account gets one free trial article. Purchase a plan to continue generating high-quality, SEO-optimised content for your business.",
    },
  };

  const { title, description } = reasonMessages[reason] ?? reasonMessages.trial_complete;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            {description}
          </DialogDescription>
        </DialogHeader>

        <Separator className="my-2" />

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-3">
            {upgradeOptions?.products.map((product) => (
              <div
                key={product.key}
                className={`relative rounded-xl border p-5 flex flex-col gap-3 transition-shadow hover:shadow-md ${PLAN_COLORS[product.key] ?? "border-border bg-background"}`}
              >
                {product.recommended && (
                  <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-xs px-2 py-0.5 shadow">
                    Recommended
                  </Badge>
                )}

                <div className="flex items-center gap-2">
                  {PLAN_ICONS[product.key]}
                  <span className="font-semibold text-sm">{product.name}</span>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  {product.description}
                </p>

                <div className="flex flex-col gap-1 text-xs">
                  {(product.articleCount ?? 0) > 0 && (
                    <span className="flex items-center gap-1.5 text-foreground">
                      <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      {product.articleCount} articles
                    </span>
                  )}
                  <span className="flex items-center gap-1.5 text-foreground">
                    <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    {product.credits} credits
                  </span>
                  <span className="flex items-center gap-1.5 text-foreground">
                    <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    Full 16-point Authority Standard
                  </span>
                  <span className="flex items-center gap-1.5 text-foreground">
                    <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    AI fingerprint scrub
                  </span>
                </div>

                <div className="mt-auto pt-2">
                  <div className="text-lg font-bold text-foreground mb-2">
                    {product.priceDisplay}
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      inc. GST
                    </span>
                  </div>
                  <Button
                    size="sm"
                    className="w-full"
                    variant={product.recommended ? "default" : "outline"}
                    disabled={loadingKey !== null}
                    onClick={() => handlePurchase(product.key)}
                  >
                    {loadingKey === product.key ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Redirecting...
                      </span>
                    ) : (
                      "Buy Now"
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 rounded-lg bg-muted/50 border border-border p-3 text-xs text-muted-foreground">
          <strong>Refund policy:</strong> All purchases are subject to our standard refund policy.
          If you are not satisfied within 7 days of purchase, contact support for a full refund.
          GST is collected automatically for Australian customers.
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5">
            <X className="h-4 w-4" />
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
