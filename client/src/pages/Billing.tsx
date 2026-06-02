/**
 * client/src/pages/Billing.tsx
 * Layer 13: Billing page — plan upgrade cards and payment history.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, CreditCard, Download, ExternalLink, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";

const REFUND_POLICY =
  "48-hour pre-generation refund guaranteed — if articles have not yet been generated, a full refund is available. No refund once generation has begun.";

const PRODUCT_DESCRIPTIONS: Record<string, { features: string[] }> = {
  citation_starter: {
    features: [
      "20 AI-optimised blog articles",
      "Full 5-stage workflow",
      "25 credits included",
      "Cornerstone → Pillar → Cluster structure",
      "Internal linking & schema markup",
    ],
  },
  citation_authority: {
    features: [
      "50 AI-optimised blog articles",
      "Full 5-stage workflow",
      "60 credits included",
      "Cornerstone → Pillar → Cluster structure",
      "Internal linking & schema markup",
      "Best value for authority sites",
    ],
  },
  credit_topup: {
    features: [
      "5 additional credits",
      "Use for regeneration or keyword swaps",
      "Never expire",
    ],
  },
};

function ProductCard({
  productKey,
  name,
  description,
  priceAud,
  credits,
  articleCount,
  highlighted,
}: {
  productKey: string;
  name: string;
  description: string;
  priceAud: number;
  credits: number;
  articleCount: number | null;
  highlighted?: boolean;
}) {
  const createSession = trpc.payments.createCheckoutSession.useMutation({
    onSuccess: ({ checkoutUrl }) => {
      toast.info("Redirecting to secure checkout…");
      window.open(checkoutUrl, "_blank");
    },
    onError: (err) => {
      toast.error(`Checkout failed: ${err.message}`);
    },
  });

  const priceDisplay = `$${(priceAud / 100).toFixed(0)} AUD`;
  const features = PRODUCT_DESCRIPTIONS[productKey]?.features ?? [];

  return (
    <Card
      className={`relative flex flex-col ${highlighted ? "border-primary shadow-lg ring-1 ring-primary/20" : ""}`}
    >
      {highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-primary text-primary-foreground px-3 py-0.5 text-xs font-semibold">
            Most Popular
          </Badge>
        </div>
      )}
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{name}</CardTitle>
        <CardDescription className="text-sm">{description}</CardDescription>
        <div className="mt-2">
          <span className="text-3xl font-bold">{priceDisplay}</span>
          <span className="text-muted-foreground text-sm ml-1">+ GST</span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4">
        <ul className="space-y-2">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-2">
          <Button
            className="w-full"
            variant={highlighted ? "default" : "outline"}
            disabled={createSession.isPending}
            onClick={() =>
              createSession.mutate({
                productKey: productKey as any,
                origin: window.location.origin,
              })
            }
          >
            {createSession.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Preparing checkout…
              </>
            ) : (
              <>
                <CreditCard className="mr-2 h-4 w-4" />
                Purchase
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentStatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    succeeded: "default",
    failed: "destructive",
    pending: "secondary",
    refunded: "outline",
  };
  const labels: Record<string, string> = {
    succeeded: "Paid",
    failed: "Failed",
    pending: "Pending",
    refunded: "Refunded",
  };
  return (
    <Badge variant={variants[status] ?? "secondary"}>
      {labels[status] ?? status}
    </Badge>
  );
}

export default function Billing() {
  const { data: products, isLoading: productsLoading } = trpc.payments.getProducts.useQuery();
  const { data: history, isLoading: historyLoading } = trpc.payments.getPaymentHistory.useQuery();

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-8 pb-12">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
          <p className="text-muted-foreground mt-1">
            Purchase article packs or top up your credits. All prices in AUD, GST collected at checkout.
          </p>
        </div>

        {/* Pricing cards */}
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Plans & Credits
          </h2>
          {productsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-72 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {products?.map((p) => (
                <ProductCard
                  key={p.key}
                  productKey={p.key}
                  name={p.name}
                  description={p.description}
                  priceAud={p.priceAud}
                  credits={p.credits}
                  articleCount={p.articleCount}
                  highlighted={p.key === "citation_authority"}
                />
              ))}
            </div>
          )}
        </section>

        {/* Refund policy */}
        <section className="rounded-lg border bg-muted/40 p-4">
          <p className="text-sm font-medium mb-1">Refund Policy</p>
          <p className="text-sm text-muted-foreground">{REFUND_POLICY}</p>
        </section>

        <Separator />

        {/* Payment history */}
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Payment History
          </h2>
          {historyLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : !history || history.length === 0 ? (
            <div className="rounded-lg border bg-muted/20 p-8 text-center">
              <CreditCard className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No payments yet.</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Credits</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Receipt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(row.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {row.productLabel}
                      </TableCell>
                      <TableCell className="text-sm">
                        ${row.amountAud} AUD
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.status === "succeeded" ? (
                          <span className="text-primary font-medium">+{row.creditsAllocated}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {row.receiptUrl ? (
                          <a
                            href={row.receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <Download className="h-3 w-3" />
                            Receipt
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
