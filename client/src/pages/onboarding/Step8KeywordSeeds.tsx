/**
 * Step 8 — Keyword Seeds
 *
 * The user builds a list of up to 10 seed keyword phrases. The AI suggests
 * seeds from the business profile; the user can edit/add/remove them. Then
 * DataForSEO expands each seed into up to 10 real keywords with MSV and
 * competition data. The user checks the ones they want to focus on — the
 * selected pool is used in Stage 3 to assign one primary keyword per article.
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
  CheckSquare,
  Square,
} from "lucide-react";

interface Props {
  businessId: number;
  onNext: () => void;
  onBack: () => void;
  articlesNeeded?: number; // how many articles in the pack (from architecture)
}

interface SeedKeyword {
  keyword: string;
  msv: number | null;
  competition: string | null;
  cpc: number | null;
}

interface SeedGroup {
  seed: string;
  keywords: SeedKeyword[];
}

const COMPETITION_COLOUR: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
};

export default function Step8KeywordSeeds({ businessId, onNext, onBack, articlesNeeded = 18 }: Props) {
  const [seeds, setSeeds] = useState<string[]>([]);
  const [groups, setGroups] = useState<SeedGroup[]>([]);
  const [poolMessage, setPoolMessage] = useState<string>("");
  const [expandedSeeds, setExpandedSeeds] = useState<Set<string>>(new Set());
  // selected = Set of "seed|||keyword" composite keys
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      const g = (data as { groups: SeedGroup[]; totalFound: number; message: string }).groups ?? [];
      setGroups(g);
      setPoolMessage((data as { message: string }).message);
      // Auto-expand all seed groups
      setExpandedSeeds(new Set(g.map((gr) => gr.seed)));
      // Auto-select all keywords by default
      const allKeys = new Set<string>();
      for (const gr of g) {
        for (const kw of gr.keywords) {
          allKeys.add(`${gr.seed}|||${kw.keyword}`);
        }
      }
      setSelected(allKeys);
      toast.success((data as { message: string }).message);
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
    // Save seeds first, then search
    await saveMutation.mutateAsync({ businessId, seeds: validSeeds });
    searchMutation.mutate({ businessId });
  };

  const handleSaveAndContinue = async () => {
    const validSeeds = seeds.map((s) => s.trim()).filter(Boolean);
    await saveMutation.mutateAsync({ businessId, seeds: validSeeds });
    onNext();
  };

  const toggleSeedGroup = (seed: string) => {
    setExpandedSeeds((prev) => {
      const next = new Set(prev);
      if (next.has(seed)) next.delete(seed);
      else next.add(seed);
      return next;
    });
  };

  const compositeKey = (seed: string, keyword: string) => `${seed}|||${keyword}`;

  const toggleKeyword = (seed: string, keyword: string) => {
    const key = compositeKey(seed, keyword);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllInGroup = (group: SeedGroup) => {
    const keys = group.keywords.map((kw) => compositeKey(group.seed, kw.keyword));
    const allSelected = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        keys.forEach((k) => next.delete(k));
      } else {
        keys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const validSeeds = seeds.filter((s) => s.trim());
  const totalKeywords = groups.reduce((sum, g) => sum + g.keywords.length, 0);
  const selectedCount = selected.size;
  const needMore = Math.max(0, articlesNeeded - selectedCount);

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
          on your business profile — edit them, then hit <strong>Search DataForSEO</strong> to get up
          to 10 real keyword suggestions per seed. Tick the ones you want to focus on — Stage 3 will
          use your selections to assign one primary keyword per article.
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
              Returns up to 10 real keywords per seed with monthly search volume and competition data.
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
            ) : groups.length > 0 ? (
              <><RefreshCw size={13} /> Regenerate Search</>
            ) : (
              <><Search size={13} /> Search DataForSEO</>
            )}
          </Button>
        </div>

        {/* Selection counter */}
        {totalKeywords > 0 && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium ${
            selectedCount >= articlesNeeded
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-amber-50 text-amber-700 border border-amber-200"
          }`}>
            <CheckSquare size={14} />
            <span>
              {selectedCount} of {articlesNeeded} keywords selected
              {needMore > 0
                ? ` — select ${needMore} more to fill your ${articlesNeeded}-article pack`
                : " — you have enough to fill your pack ✓"}
            </span>
          </div>
        )}

        {poolMessage && groups.length === 0 && (
          <p className="text-xs text-muted-foreground">{poolMessage}</p>
        )}

        {/* Results grouped by seed — each row has a checkbox */}
        {groups.length > 0 && (
          <div className="space-y-2 mt-2">
            {groups.map((group) => {
              const groupKeys = group.keywords.map((kw) => compositeKey(group.seed, kw.keyword));
              const allGroupSelected = groupKeys.length > 0 && groupKeys.every((k) => selected.has(k));
              const someGroupSelected = groupKeys.some((k) => selected.has(k));
              const groupSelectedCount = groupKeys.filter((k) => selected.has(k)).length;

              return (
                <div key={group.seed} className="border rounded-md bg-background overflow-hidden">
                  {/* Seed group header */}
                  <div className="flex items-center px-3 py-2 gap-2 hover:bg-muted/20 transition-colors">
                    {/* Select-all toggle for this group */}
                    <button
                      onClick={() => toggleAllInGroup(group)}
                      className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                      title={allGroupSelected ? "Deselect all in group" : "Select all in group"}
                    >
                      {allGroupSelected ? (
                        <CheckSquare size={15} className="text-primary" />
                      ) : someGroupSelected ? (
                        <CheckSquare size={15} className="text-primary/50" />
                      ) : (
                        <Square size={15} />
                      )}
                    </button>
                    <button
                      className="flex-1 flex items-center justify-between text-sm font-medium text-left"
                      onClick={() => toggleSeedGroup(group.seed)}
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-primary">{group.seed}</span>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                          {groupSelectedCount}/{group.keywords.length} selected
                        </Badge>
                      </span>
                      {expandedSeeds.has(group.seed) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>

                  {/* Keyword rows */}
                  {expandedSeeds.has(group.seed) && (
                    <div className="border-t">
                      {group.keywords.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-3 py-2">No results returned for this seed.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b bg-muted/30">
                              <th className="w-8 px-3 py-1.5" />
                              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Keyword</th>
                              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground w-20">MSV/mo</th>
                              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground w-24">Competition</th>
                              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground w-16">CPC</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.keywords.map((kw, i) => {
                              const key = compositeKey(group.seed, kw.keyword);
                              const isChecked = selected.has(key);
                              return (
                                <tr
                                  key={i}
                                  className={`border-b last:border-0 cursor-pointer transition-colors ${
                                    isChecked ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/10"
                                  }`}
                                  onClick={() => toggleKeyword(group.seed, kw.keyword)}
                                >
                                  <td className="px-3 py-1.5 text-center">
                                    {isChecked ? (
                                      <CheckSquare size={13} className="text-primary mx-auto" />
                                    ) : (
                                      <Square size={13} className="text-muted-foreground mx-auto" />
                                    )}
                                  </td>
                                  <td className={`px-3 py-1.5 ${isChecked ? "font-medium" : ""}`}>
                                    {kw.keyword}
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums">
                                    {kw.msv != null ? kw.msv.toLocaleString() : "—"}
                                  </td>
                                  <td className="px-3 py-1.5 text-right">
                                    {kw.competition ? (
                                      <span
                                        className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
                                        style={{ backgroundColor: COMPETITION_COLOUR[kw.competition] ?? "#6b7280" }}
                                      >
                                        {kw.competition}
                                      </span>
                                    ) : "—"}
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                    {kw.cpc != null ? `$${kw.cpc.toFixed(2)}` : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
