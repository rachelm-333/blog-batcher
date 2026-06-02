/**
 * client/src/pages/SupportCentre.tsx
 *
 * Layer 11 — Support Centre
 *
 * Features:
 *  - Search bar with debounced full-text search
 *  - Topic sidebar with article count badges
 *  - Article viewer with rich content blocks
 *  - Contact form (submits to rachel.m@noize.com.au)
 *  - URL hash navigation: /support#article-slug
 *  - Empty state for no search results
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Search,
  HelpCircle,
  Rocket,
  Building2,
  Network,
  BarChart2,
  FileText,
  CheckSquare,
  Calendar,
  CreditCard,
  ChevronRight,
  ArrowLeft,
  AlertCircle,
  Lightbulb,
  AlertTriangle,
  Code,
  List,
  Mail,
  Loader2,
  BookOpen,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Icon map for topic icons
// ---------------------------------------------------------------------------
const TOPIC_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Rocket,
  Building2,
  Network,
  Search: BarChart2,
  FileText,
  CheckSquare,
  Calendar,
  CreditCard,
};

// ---------------------------------------------------------------------------
// Content block renderer
// ---------------------------------------------------------------------------
type ContentBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "list"; items: string[] }
  | { type: "tip"; text: string }
  | { type: "warning"; text: string };

function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "heading":
      return (
        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">
          {block.text}
        </h3>
      );
    case "paragraph":
      return (
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
          {block.text}
        </p>
      );
    case "code":
      return (
        <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto mb-3 border">
          <code>{block.text}</code>
        </pre>
      );
    case "list":
      return (
        <ul className="space-y-1 mb-3 ml-1">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
              <span className="leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>
      );
    case "tip":
      return (
        <div className="flex gap-3 p-3 bg-primary/10 border border-primary/30 rounded-md mb-3">
          <Lightbulb className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-sm text-primary leading-relaxed">{block.text}</p>
        </div>
      );
    case "warning":
      return (
        <div className="flex gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md mb-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700 dark:text-amber-300 leading-relaxed">{block.text}</p>
        </div>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Contact Form
// ---------------------------------------------------------------------------
function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = trpc.support.submitContactForm.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setForm({ name: "", email: "", subject: "", message: "" });
    },
    onError: (err) => {
      toast.error(err.message || "Failed to send message. Please try again.");
    },
  });

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
        <div className="h-12 w-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Mail className="h-6 w-6 text-green-600" />
        </div>
        <h3 className="font-semibold text-foreground">Message sent</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Your message has been sent. We'll get back to you within 1 business day.
        </p>
        <Button variant="outline" size="sm" onClick={() => setSubmitted(false)}>
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitMutation.mutate(form);
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Name</label>
          <Input
            placeholder="Your name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Email</label>
          <Input
            type="email"
            placeholder="your@email.com"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Subject</label>
        <Input
          placeholder="What do you need help with?"
          value={form.subject}
          onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
          required
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Message</label>
        <Textarea
          placeholder="Describe your issue in detail. Include any error messages you see."
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          rows={5}
          required
          minLength={10}
        />
      </div>
      <Button
        type="submit"
        disabled={submitMutation.isPending}
        className="w-full sm:w-auto"
      >
        {submitMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <Mail className="h-4 w-4 mr-2" />
            Send Message
          </>
        )}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main Support Centre page
// ---------------------------------------------------------------------------
export default function SupportCentre() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [showContact, setShowContact] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Handle URL hash navigation (e.g. /support#connect-wordpress)
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      setSelectedSlug(hash);
      setSearchQuery("");
    }
  }, []);

  // Queries
  const { data: topics = [] } = trpc.support.getTopics.useQuery();
  const { data: searchResults, isLoading: isSearching } = trpc.support.search.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 }
  );
  const { data: article, isLoading: isLoadingArticle } = trpc.support.getArticle.useQuery(
    { slug: selectedSlug ?? "" },
    { enabled: !!selectedSlug }
  );

  const isSearchMode = debouncedQuery.length >= 2;

  const openArticle = useCallback((slug: string) => {
    setSelectedSlug(slug);
    setSearchQuery("");
    setShowContact(false);
    window.history.replaceState(null, "", `/support#${slug}`);
  }, []);

  const goBack = useCallback(() => {
    setSelectedSlug(null);
    setShowContact(false);
    window.history.replaceState(null, "", "/support");
  }, []);

  // Get articles for selected topic
  const topicArticles = selectedTopicId
    ? topics.find((t) => t.id === selectedTopicId)?.articles ?? []
    : [];

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="border-b bg-background px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <HelpCircle className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Help Centre</h1>
              <p className="text-xs text-muted-foreground">Find answers, guides, and support</p>
            </div>
          </div>
          {/* Search */}
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search help articles…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedSlug(null);
                setSelectedTopicId(null);
                setShowContact(false);
              }}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-56 flex-shrink-0 border-r bg-muted/30 overflow-y-auto p-3 space-y-1">
            <button
              onClick={() => { setSelectedTopicId(null); setSelectedSlug(null); setShowContact(false); setSearchQuery(""); }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                !selectedTopicId && !selectedSlug && !showContact && !isSearchMode
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <BookOpen className="h-4 w-4 flex-shrink-0" />
              <span>All Topics</span>
            </button>

            <Separator className="my-2" />

            {topics.map((topic) => {
              const Icon = TOPIC_ICONS[topic.icon] ?? HelpCircle;
              const isActive = selectedTopicId === topic.id && !selectedSlug;
              return (
                <button
                  key={topic.id}
                  onClick={() => {
                    setSelectedTopicId(topic.id);
                    setSelectedSlug(null);
                    setShowContact(false);
                    setSearchQuery("");
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{topic.label}</span>
                  </div>
                  <Badge
                    variant="secondary"
                    className={`text-xs px-1.5 py-0 flex-shrink-0 ${isActive ? "bg-primary-foreground/20 text-primary-foreground" : ""}`}
                  >
                    {topic.articles.length}
                  </Badge>
                </button>
              );
            })}

            <Separator className="my-2" />

            <button
              onClick={() => { setShowContact(true); setSelectedSlug(null); setSelectedTopicId(null); setSearchQuery(""); }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                showContact
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Mail className="h-4 w-4 flex-shrink-0" />
              <span>Contact Support</span>
            </button>
          </div>

          {/* Main content */}
          <div className="flex-1 overflow-y-auto p-6">

            {/* ── Search results ── */}
            {isSearchMode && (
              <div>
                <h2 className="text-sm font-medium text-muted-foreground mb-4">
                  {isSearching
                    ? "Searching…"
                    : searchResults && searchResults.length > 0
                    ? `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} for "${debouncedQuery}"`
                    : `No results for "${debouncedQuery}"`}
                </h2>

                {searchResults && searchResults.length === 0 && !isSearching && (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                      <Search className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">No articles found for "{debouncedQuery}"</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Try a different search term, or browse by topic using the sidebar.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setShowContact(true); setSearchQuery(""); }}
                    >
                      <Mail className="h-4 w-4 mr-2" />
                      Contact Support
                    </Button>
                  </div>
                )}

                {searchResults && searchResults.length > 0 && (
                  <div className="space-y-2">
                    {searchResults.map((result) => (
                      <button
                        key={result.id}
                        onClick={() => openArticle(result.slug)}
                        className="w-full text-left p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-foreground text-sm group-hover:text-primary transition-colors">
                              {result.title}
                            </p>
                            {result.snippet && (
                              <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                                {result.snippet}
                              </p>
                            )}
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5 group-hover:text-primary transition-colors" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Article viewer ── */}
            {!isSearchMode && selectedSlug && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goBack}
                  className="mb-4 -ml-2 text-muted-foreground"
                >
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>

                {isLoadingArticle && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading article…</span>
                  </div>
                )}

                {!isLoadingArticle && !article && (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                    <AlertCircle className="h-8 w-8 text-muted-foreground" />
                    <p className="font-medium text-foreground">Article not found</p>
                    <p className="text-sm text-muted-foreground">
                      This help article doesn't exist. Try searching for what you need.
                    </p>
                  </div>
                )}

                {!isLoadingArticle && article && (
                  <div className="max-w-2xl">
                    {article.topic && (
                      <Badge variant="secondary" className="mb-3 text-xs">
                        {article.topic.label}
                      </Badge>
                    )}
                    <h2 className="text-xl font-semibold text-foreground mb-4">{article.title}</h2>
                    <div>
                      {article.body.map((block, i) => (
                        <ContentBlockRenderer key={i} block={block as ContentBlock} />
                      ))}
                    </div>
                    <Separator className="my-8" />
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">Was this article helpful?</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setShowContact(true); setSelectedSlug(null); }}
                      >
                        <Mail className="h-4 w-4 mr-2" />
                        Contact Support
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Topic article list ── */}
            {!isSearchMode && !selectedSlug && selectedTopicId && !showContact && (
              <div>
                {(() => {
                  const topic = topics.find((t) => t.id === selectedTopicId);
                  const Icon = topic ? (TOPIC_ICONS[topic.icon] ?? HelpCircle) : HelpCircle;
                  return (
                    <>
                      <div className="flex items-center gap-3 mb-6">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h2 className="text-base font-semibold text-foreground">{topic?.label}</h2>
                          <p className="text-xs text-muted-foreground">{topic?.description}</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {topicArticles.map((art) => (
                          <button
                            key={art.id}
                            onClick={() => openArticle(art.slug)}
                            className="w-full text-left p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors group flex items-center justify-between"
                          >
                            <div className="flex items-center gap-3">
                              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                                {art.title}
                              </span>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />
                          </button>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* ── Contact form ── */}
            {!isSearchMode && showContact && (
              <div className="max-w-xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Mail className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Contact Support</h2>
                    <p className="text-xs text-muted-foreground">
                      We'll get back to you within 1 business day.
                    </p>
                  </div>
                </div>
                <ContactForm />
              </div>
            )}

            {/* ── All topics overview ── */}
            {!isSearchMode && !selectedSlug && !selectedTopicId && !showContact && (
              <div>
                <h2 className="text-base font-semibold text-foreground mb-1">Browse by topic</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Select a topic from the sidebar, or search for what you need above.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {topics.map((topic) => {
                    const Icon = TOPIC_ICONS[topic.icon] ?? HelpCircle;
                    return (
                      <button
                        key={topic.id}
                        onClick={() => setSelectedTopicId(topic.id)}
                        className="text-left p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors group"
                      >
                        <div className="flex items-start gap-3">
                          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                            <Icon className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                                {topic.label}
                              </p>
                              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                                {topic.articles.length}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                              {topic.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <Separator className="my-8" />

                <div className="flex items-start gap-4 p-4 rounded-lg border bg-card">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Mail className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">Can't find what you need?</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Send us a message and we'll get back to you within 1 business day.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowContact(true)}
                  >
                    Contact Support
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
