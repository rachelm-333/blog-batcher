/**
 * client/src/pages/PaymentCancelled.tsx
 * Layer 13: Payment cancelled page.
 * Stripe redirects here when the user cancels checkout.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { XCircle } from "lucide-react";
import { useLocation } from "wouter";

export default function PaymentCancelled() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <XCircle className="h-9 w-9 text-muted-foreground" />
            </div>
          </div>
          <CardTitle className="text-xl">Payment Cancelled</CardTitle>
          <CardDescription>
            No charges were made. You can return to billing and try again whenever you're ready.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <Button onClick={() => setLocation("/billing")} className="w-full">
            Return to Billing
          </Button>
          <Button
            variant="outline"
            onClick={() => setLocation("/dashboard")}
            className="w-full"
          >
            Go to Dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
