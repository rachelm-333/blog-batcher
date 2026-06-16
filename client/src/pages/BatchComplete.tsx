/**
 * client/src/pages/BatchComplete.tsx
 *
 * Shown when ALL articles in the active batch are published or scheduled.
 * Provides a read-only summary of the completed batch and a "Start New Batch" CTA.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useActiveBusiness } from "@/contexts/BusinessContext";
import { CheckCircle2, Plus, FileText, Calendar } from "lucide-react";
import { toast } from "sonner";

export default function BatchComplete() {
  const [, setLocation] = useLocation();
  const { activeBusiness, refetch: refetchBusiness } = useActiveBusiness();
  const businessId = activeBusiness?.id ?? 0;
  const activeBatch = Number(activeBusiness?.activeBatch ?? 1);

  const [starting, setStarting] = useState(false);

  // Fetch all articles for the completed batch
  const { data: articleRows, isLoading } = trpc.articles.getAll.useQuery(
    { businessId },
    { enabled: !!businessId }
  );

  const startNewBatch = trpc.business.startNewBatch.useMutation({
    onSuccess: async (data) => {
      await refetchBusiness();
      toast.success(`Batch ${data.newBatch} started — ready to build your next set of articles.`);
      setLocation("/architecture");
    },
    onError: (err) => {
      toast.error(err.message ?? "Could not start new batch");
      setStarting(false);
    },
  });

  const publishedArticles = (articleRows ?? []).filter(
    (a) => a.status === "published" || a.status === "scheduled"
  );
  const totalArticles = articleRows?.length ?? 0;
  const publishedCount = publishedArticles.length;
  const nextBatch = activeBatch + 1;

  function handleStartNewBatch() {
    if (!businessId) return;
    setStarting(true);
    startNewBatch.mutate({ businessId });
  }

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Success header */}
        <div className="flex flex-col items-center text-center mb-10">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
            style={{ background: "#dcfce7" }}
          >
            <CheckCircle2 className="w-10 h-10" style={{ color: "#16a34a" }} />
          </div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#1a1a2e" }}>
            Batch {activeBatch} Complete
          </h1>
          <p className="text-base" style={{ color: "#6b7280" }}>
            {publishedCount} of {totalArticles} article{totalArticles !== 1 ? "s" : ""} published or scheduled.
            Your previous batch is now locked and read-only.
          </p>
        </div>

        {/* CTA */}
        <div
          className="rounded-xl p-6 mb-8 flex flex-col sm:flex-row items-center gap-4"
          style={{ background: "#f5f3ff", border: "1.5px solid #c4b5fd" }}
        >
          <div className="flex-1 text-center sm:text-left">
            <p className="font-semibold text-base mb-1" style={{ color: "#4c1d95" }}>
              Ready to grow your blog further?
            </p>
            <p className="text-sm" style={{ color: "#7c3aed" }}>
              Start Batch {nextBatch} — your business profile is already set up.
              You will go straight to Blog Architecture.
            </p>
          </div>
          <Button
            onClick={handleStartNewBatch}
            disabled={starting || startNewBatch.isPending}
            className="flex items-center gap-2 px-6 py-3 text-base font-semibold flex-shrink-0"
            style={{ background: "#6e5afe", color: "#fff", minWidth: 200 }}
          >
            {(starting || startNewBatch.isPending) ? (
              <>
                <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" />
                Starting…
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Start Batch {nextBatch} →
              </>
            )}
          </Button>
        </div>

        {/* Article list */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid #e5e7eb" }}
        >
          <div
            className="px-5 py-3 flex items-center justify-between"
            style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}
          >
            <span className="font-semibold text-sm" style={{ color: "#374151" }}>
              Published articles — Batch {activeBatch}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: "#dcfce7", color: "#16a34a" }}>
              {publishedCount} article{publishedCount !== 1 ? "s" : ""}
            </span>
          </div>

          {isLoading ? (
            <div className="px-5 py-8 text-center text-sm" style={{ color: "#9ca3af" }}>
              Loading articles…
            </div>
          ) : publishedArticles.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm" style={{ color: "#9ca3af" }}>
              No published articles found in this batch.
            </div>
          ) : (
            <ul>
              {publishedArticles.map((article, i) => (
                <li
                  key={article.id}
                  className="px-5 py-3 flex items-center gap-3"
                  style={{
                    borderBottom: i < publishedArticles.length - 1 ? "1px solid #f3f4f6" : "none",
                  }}
                >
                  <FileText className="w-4 h-4 flex-shrink-0" style={{ color: "#9ca3af" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "#1a1a2e" }}>
                      {article.title ?? article.focusKeyword ?? "Untitled"}
                    </p>
                    {article.urlSlug && (
                      <p className="text-xs truncate" style={{ color: "#9ca3af" }}>
                        /{article.urlSlug}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {article.status === "scheduled" ? (
                      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#eff6ff", color: "#2563eb" }}>
                        <Calendar className="w-3 h-3" />
                        Scheduled
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#dcfce7", color: "#16a34a" }}>
                        <CheckCircle2 className="w-3 h-3" />
                        Published
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs mt-6" style={{ color: "#9ca3af" }}>
          Batch {activeBatch} is locked. All articles are read-only and cannot be edited or regenerated.
          <br />
          Start a new batch to create fresh content for your blog.
        </p>
      </div>
    </DashboardLayout>
  );
}
