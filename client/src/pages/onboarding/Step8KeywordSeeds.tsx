/**
 * Step 8 — Keyword Seeds
 *
 * The user builds a list of up to 10 seed keyword phrases. The AI suggests
 * seeds from the business profile; the user can edit/add/remove them. Then
 * DataForSEO expands each seed into a pool of real keywords with MSV and
 * competition data. The pool is saved and used in Stage 3 to assign one
 * primary keyword per article slot.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import {
  Loader2,
  Sparkles,
  Search,
  X,
  Plus,
  RefreshCw,
  TrendingUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Props {
  businessId: number;
  onNext: () => void;
  onBack: () => void;
}

interface PoolKeyword {
  seed: string;
  keyword: string;
  msv: number | null;
  competition: string | null;
  cpc: number | null;
}

const COMPETITION_COLOUR: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
};

export default function Step8KeywordSeeds({ businessId, onNext, onBack }: Props) {
  const [seeds, setSeeds] = useState<string[]>([]);
  const [pool, setPool] = useState<PoolKeyword[]>([]);
  const [poolMessage, setPoolMessage] = useState<string>("");
  const [expandedSeeds, setExpandedSeeds] = useState<Set<string>>(new Set());

  // Load existing seeds on mount
  const { data: existingSeeds, isLoading: seedsLoading } = trpc.keywordSeeds.getAll.useQuery(
    { businessId },
    { enabled: !!businessId }
  );

  useEffect(() => {
    if (existingSeeds && existingSeeds.length > 0) {
      setSeeds(existingSeeds.map((s) => s.keyword));
    }
  }, [existingSeeds]);

  const suggestMutation = trpc.keywordSeeds.suggest.useMutation({
    onSuccess: (data) => {
      setSeeds(data.seeds);
      toast.success(`${data.seeds.length} seed keywords suggested — edit them to your liking.`);
    },
    onError: (err) => toast.error(err.message),
  });

  const saveMutation = trpc.keywordSeeds.save.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const searchMutation = trpc.keywordSeeds.searchDataForSEO.useMutation({
    onSuccess: (data) => {
      setPool(data.results as PoolKeyword[]);
      setPoolMessage(data.message);
      // Auto-expand all seeds
      const seedNames = new Set(data.results.map((r: PoolKeyword) => r.seed));
      setExpandedSeeds(seedNames);
      toast.success(data.message);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSuggest = () => {
    suggestMutation.mutate({ businessId });
  };

  const handleAddSeed = () => {
    if (seeds.length >= 10) {
      toast.error("Maximum 10 seed keywords allowed.");
      return;
    }
    setSeeds([...seeds, ""]);
  };

  const handleRemoveSeed = (idx: number) => {
    setSeeds(seeds.filter((_, i) => i !== idx));
  };

  const handleSeedChange = (idx: number, value: string) => {
    const updated = [...seeds];
    updated[idx] = value;
    setSeeds(updated);
  };

  const handleSearch = async () => {
    const validSeeds = seeds.map((s) => s.trim()).filter(Boolean);
    if (validSeeds.length === 0) {
      toast.error("Add at least one seed keyword before searching.");
      return;
    }
    // Save seeds first
    await saveMutation.mutateAsync({ businessId, seeds: validSeeds });
    // Then search DataForSEO
    searchMutation.mutate({ businessId });
  };

  const handleSaveAndContinue = async () => {
    const validSeeds = seeds.map((s) => s.trim()).filter(Boolean);
    await saveMutation.mutateAsync({ businessId, seeds: validSeeds });
    onNext();
  };

  // Group pool by seed
  const poolBySeed = pool.reduce<Record<string, PoolKeyword[]>>((acc, item) => {
    if (!acc[item.seed]) acc[item.seed] = [];
    acc[item.seed].push(item);
    return acc;
  }, {});

  const toggleSeedGroup = (seed: string) => {
    setExpandedSeeds((prev) => {
      const next = new Set(prev);
      if (next.has(seed)) next.delete(seed);
      else next.add(seed);
      return next;
    });
  };

  const validSeeds = seeds.filter((s) => s.trim());

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-primary font-semibold text-sm mb-1">
          <TrendingUp size={16} />
          Step 8 of 9 — Keyword Seeds
        </div>
        <h1 className="text-2xl font-bold">Build your keyword foundation.</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          These seed phrases tell DataForSEO what topics to research. The AI will suggest seeds based
          on your business profile — edit them, then hit <strong>Search DataForSEO</strong> to get real
          search volume data. Your Stage 3 keyword assignment will use this real data instead of AI guesses.
        </p>
      </div>

      {/* Seed list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">
            Seed keywords <span className="text-muted-foreground">({validSeeds.length}/10)</span>
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSuggest}
            disabled={suggestMutation.isPending}
            className="gap-1.5"
          >
            {suggestMutation.isPending ? (
              <><Loader2 size={13} className="animate-spin" /> Suggesting…</>
            ) : (
              <><Sparkles size={13} /> AI Suggest</>
            )}
          </Button>
        </div>

        {seedsLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
            <Loader2 size={14} className="animate-spin" /> Loading saved seeds…
          </div>
        ) : (
          <div className="space-y-2">
            {seeds.map((seed, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{idx + 1}.</span>
                <Input
                  value={seed}
                  onChange={(e) => handleSeedChange(idx, e.target.value)}
                  placeholder="e.g. pitch deck design"
                  className="flex-1 h-9 text-sm"
                  maxLength={255}
                />
                <button
                  onClick={() => handleRemoveSeed(idx)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                  title="Remove"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {seeds.length < 10 && (
              <button
                onClick={handleAddSeed}
                className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors mt-1"
              >
                <Plus size={14} /> Add keyword
              </button>
            )}
            {seeds.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">
                Click <strong>AI Suggest</strong> to generate seeds from your business profile, or add them manually.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Search DataForSEO */}
      <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">DataForSEO Keyword Research</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Expands each seed into real keywords with monthly search volume and competition data.
            </p>
          </div>
          <Button
            onClick={handleSearch}
            disabled={searchMutation.isPending || saveMutation.isPending || validSeeds.length === 0}
            size="sm"
            className="gap-1.5 shrink-0"
          >
            {searchMutation.isPending || saveMutation.isPending ? (
              <><Loader2 size={13} className="animate-spin" /> Searching…</>
            ) : pool.length > 0 ? (
              <><RefreshCw size={13} /> Regenerate Search</>
            ) : (
              <><Search size={13} /> Search DataForSEO</>
            )}
          </Button>
        </div>

        {poolMessage && (
          <p className="text-xs text-muted-foreground">{poolMessage}</p>
        )}

        {/* Results grouped by seed */}
        {pool.length > 0 && (
          <div className="space-y-2 mt-2">
            {Object.entries(poolBySeed).map(([seed, items]) => (
              <div key={seed} className="border rounded-md bg-background overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/30 transition-colors"
                  onClick={() => toggleSeedGroup(seed)}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-primary">{seed}</span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                      {items.length} keywords
                    </Badge>
                  </span>
                  {expandedSeeds.has(seed) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {expandedSeeds.has(seed) && (
                  <div className="border-t">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Keyword</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground w-20">MSV/mo</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground w-24">Competition</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, i) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-muted/10">
                            <td className="px-3 py-1.5">{item.keyword}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {item.msv != null ? item.msv.toLocaleString() : "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {item.competition ? (
                                <span
                                  className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
                                  style={{ backgroundColor: COMPETITION_COLOUR[item.competition] ?? "#6b7280" }}
                                >
                                  {item.competition}
                                </span>
                              ) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button
          onClick={handleSaveAndContinue}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <><Loader2 size={14} className="animate-spin mr-1" /> Saving…</>
          ) : (
            "Save & Continue →"
          )}
        </Button>
      </div>
    </div>
  );
}
