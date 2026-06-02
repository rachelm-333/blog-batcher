/**
 * client/src/pages/PaymentSuccess.tsx
 * Layer 13: Payment success redirect page.
 * Stripe redirects here after a successful checkout with ?session_id=...
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";

const PRODUCT_LABELS: Record<string, string> = {
  citation_starter: "Citation Starter — 20 Articles",
  citation_authority: "Citation Authority — 50 Articles",
  credit_topup: "Credit Top-Up — 5 Credits",
};

export default function PaymentSuccess() {
  const [, setLocation] = useLocation();

  // Get session_id from URL query params
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id") ?? "";

  const { data, isLoading, error } = trpc.payments.getCheckoutSession.useQuery(
    { sessionId },
    { enabled: !!sessionId, retry: 3, retryDelay: 2000 }
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full shadow-lg">
        <CardHeader className="text-center pb-2">
          {isLoading ? (
            <Skeleton className="h-16 w-16 rounded-full mx-auto mb-4" />
          ) : (
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-9 w-9 text-green-600" />
              </div>
            </div>
          )}
          <CardTitle className="text-xl">
            {isLoading ? <Skeleton className="h-6 w-40 mx-auto" /> : "Payment Successful!"}
          </CardTitle>
          <CardDescription>
            {isLoading ? (
              <Skeleton className="h-4 w-56 mx-auto mt-2" />
            ) : error ? (
              "Your payment was received. Credits will appear in your account shortly."
            ) : (
              `Your ${PRODUCT_LABELS[data?.productKey ?? ""] ?? "purchase"} is now active.`
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {!isLoading && !error && data && (
            <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Product</span>
                <span className="font-medium">{PRODUCT_LABELS[data.productKey ?? ""] ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount paid</span>
                <span className="font-medium">
                  ${((data.amountTotal ?? 0) / 100).toFixed(2)} {(data.currency ?? "aud").toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium text-green-600 capitalize">{data.status}</span>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            A receipt has been sent to your email. You can also download it from the{" "}
            <button
              className="text-primary underline"
              onClick={() => setLocation("/billing")}
            >
              Billing page
            </button>
            .
          </p>

          <div className="flex flex-col gap-2">
            <Button onClick={() => setLocation("/dashboard")} className="w-full">
              Go to Dashboard
            </Button>
            <Button
              variant="outline"
              onClick={() => setLocation("/billing")}
              className="w-full"
            >
              View Billing History
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
