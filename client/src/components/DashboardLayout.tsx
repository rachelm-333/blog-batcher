import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  LayoutDashboard, LogOut, Calendar, Puzzle, HelpCircle,
  CreditCard, Shield, ChevronDown, Plus, Menu, X, Search, Grid3X3
} from "lucide-react";
import { useActiveBusiness } from "@/contexts/BusinessContext";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import ImpersonationBanner from "./ImpersonationBanner";

/* ─── Nav structure ─────────────────────────────────────── */
const WORKFLOW_ITEMS = [
  { num: 1, label: "Business profile",   path: "/onboarding",   stage: 1 },
  { num: 2, label: "Blog architecture",  path: "/architecture", stage: 2 },
  { num: 3, label: "Keyword research",   path: "/keywords",     stage: 3 },
  { num: 4, label: "Article generation", path: "/generate",     stage: 4 },
  { num: 5, label: "Review & edit",      path: "/review",       stage: 5 },
  { num: 6, label: "Publish & schedule", path: "/publish",      stage: 6 },
];
const MANAGE_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard",    path: "/dashboard" },
  { icon: Calendar,        label: "Schedule",     path: "/schedule-management" },
  { icon: Puzzle,          label: "Integrations", path: "/integrations" },
  { icon: CreditCard,      label: "Billing",      path: "/billing" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#faf9f5" }}>
        <div className="flex flex-col items-center gap-6 p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-2"
            style={{ background: "#ede9ff", border: "1px solid #c4b5fd" }}>
            <Shield className="w-8 h-8" style={{ color: "#6e5afe" }} />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: "#1a1a2e" }}>Sign in to continue</h1>
          <p className="text-sm" style={{ color: "#6b7280" }}>Access to this dashboard requires authentication.</p>
          <button
            onClick={() => { window.location.href = getLoginUrl(); }}
            className="w-full py-3 px-6 rounded-lg font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: "#6e5afe" }}
          >
            Sign in with Manus
          </button>
        </div>
      </div>
    );
  }
  return <DashboardLayoutContent>{children}</DashboardLayoutContent>;
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const isAdmin = user && (user.role === "admin" || user.email === "rachel.m@noize.com.au");
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bizDropOpen, setBizDropOpen] = useState(false);
  const bizDropRef = useRef<HTMLDivElement>(null);

  const { businesses, activeBusiness: activeBiz, selectedBizId, setSelectedBizId, refetch: refetchBusinesses } = useActiveBusiness();
  const deleteBusiness = trpc.business.delete.useMutation({
    onSuccess: () => { void refetchBusinesses(); },
  });
  const [deletingBizId, setDeletingBizId] = useState<number | null>(null);
  const { data: summary } = trpc.dashboard.getSummary.useQuery(
    { businessId: activeBiz?.id ?? 0 },
    { enabled: !!activeBiz?.id, retry: false }
  );
  const credits = summary?.creditBalance ?? 0;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bizDropRef.current && !bizDropRef.current.contains(e.target as Node)) {
        setBizDropOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isActive = (path: string) => location === path || location.startsWith(path + "/");

  const currentStage = activeBiz?.currentStage ?? 1;

  // Data-driven stage completion — don't rely solely on DB currentStage number
  // which can lag behind actual progress
  const sc = summary?.statusCounts ?? {};
  const articlesWritten = (sc.generated ?? 0) + (sc.pending_approval ?? 0) + (sc.approved ?? 0) + (sc.scheduled ?? 0) + (sc.published ?? 0);
  const approvedCount = (sc.approved ?? 0) + (sc.scheduled ?? 0) + (sc.published ?? 0);
  const publishedOrScheduled = (sc.scheduled ?? 0) + (sc.published ?? 0);
  const totalArticles = sc.total ?? 0;
  const isBatchComplete = totalArticles > 0 && publishedOrScheduled === totalArticles;
  const activeBatch = Number(activeBiz?.activeBatch ?? 1);

  function isStageComplete(stageNum: number): boolean {
    if (stageNum === 1) return currentStage > 1;
    if (stageNum === 2) return currentStage > 2;
    if (stageNum === 3) return currentStage > 3;
    if (stageNum === 4) return articlesWritten > 0;
    if (stageNum === 5) return approvedCount > 0;
    if (stageNum === 6) return publishedOrScheduled > 0;
    return false;
  }

  function isStageLocked(stageNum: number): boolean {
    if (stageNum <= 3) return currentStage < stageNum;
    if (stageNum === 4) return currentStage < 4;
    if (stageNum === 5) return articlesWritten === 0;
    if (stageNum === 6) return approvedCount === 0;
    return false;
  }

  /* ── Sidebar ── */
  function SidebarContent() {
    return (
      <div className="flex flex-col h-full" style={{ background: "#ffffff", borderRight: "1px solid #e5e7eb", width: "200px" }}>
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-4 flex-shrink-0" style={{ borderBottom: "1px solid #e5e7eb" }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "#6e5afe" }}>
            <span className="text-white font-bold text-xs">B</span>
          </div>
          <span className="font-bold text-sm" style={{ color: "#1a1a2e" }}>BlogBatcher</span>
        </div>

        {/* Business switcher */}
        <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid #e5e7eb" }}>
          <div className="relative" ref={bizDropRef}>
            <button
              onClick={() => setBizDropOpen(v => !v)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left transition-colors"
              style={{ background: bizDropOpen ? "#ede9ff" : "#f5f3ec", border: "1px solid #e5e7eb" }}
            >
              <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                style={{ background: "#6e5afe" }}>
                <span className="text-white font-bold" style={{ fontSize: "9px" }}>B</span>
              </div>
              <span className="flex-1 truncate text-xs font-semibold" style={{ color: "#1a1a2e" }}>
                {activeBiz?.name ?? "Select business"}
              </span>
              <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: "#9ca3af", transform: bizDropOpen ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
            </button>
            {bizDropOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 rounded-lg shadow-lg z-50 overflow-hidden"
                style={{ background: "#fff", border: "1px solid #e5e7eb" }}>
                {businesses?.map(biz => (
                  <button
                    key={biz.id}
                    onClick={() => {
                      setSelectedBizId(biz.id);
                      setBizDropOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                    style={{
                      background: biz.id === activeBiz?.id ? "#ede9ff" : "transparent",
                      color: biz.id === activeBiz?.id ? "#6e5afe" : "#374151",
                      fontSize: "12px",
                      fontWeight: biz.id === activeBiz?.id ? 600 : 400,
                    }}
                    onMouseEnter={e => { if (biz.id !== activeBiz?.id) (e.currentTarget as HTMLButtonElement).style.background = "#f5f3ec"; }}
                    onMouseLeave={e => { if (biz.id !== activeBiz?.id) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                  >
                    <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: biz.id === activeBiz?.id ? "#6e5afe" : "#e5e7eb" }}>
                      <span style={{ fontSize: "8px", color: biz.id === activeBiz?.id ? "#fff" : "#9ca3af", fontWeight: 700 }}>
                        {biz.name?.charAt(0).toUpperCase() ?? "B"}
                      </span>
                    </div>
                    <span className="flex-1 truncate">{biz.name}</span>
                    {biz.id === activeBiz?.id && <span style={{ fontSize: 10, color: "#6e5afe" }}>✓</span>}
                    {biz.id !== activeBiz?.id && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          if (!confirm(`Delete "${biz.name}"? This cannot be undone.`)) return;
                          setDeletingBizId(biz.id);
                          deleteBusiness.mutate({ businessId: biz.id }, {
                            onError: (err) => { alert(err.message); setDeletingBizId(null); },
                            onSettled: () => setDeletingBizId(null),
                          });
                        }}
                        title="Delete this business"
                        style={{ color: deletingBizId === biz.id ? "#9ca3af" : "#ef4444", padding: "2px", borderRadius: "3px", lineHeight: 1 }}
                        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "#fee2e2"}
                        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "transparent"}
                      >
                        <span style={{ fontSize: 11 }}>{deletingBizId === biz.id ? "…" : "✕"}</span>
                      </button>
                    )}
                  </button>
                ))}
                <div style={{ borderTop: "1px solid #e5e7eb" }}>
                  <button
                    onClick={() => { setBizDropOpen(false); setLocation("/onboarding?new=1"); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                    style={{ color: "#6e5afe", fontSize: "12px", fontWeight: 600 }}
                    onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "#f5f3ec"}
                    onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "transparent"}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add new business
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Batch indicator */}
        {activeBiz && (
          <div className="px-3 py-1.5 flex-shrink-0" style={{ borderBottom: "1px solid #e5e7eb" }}>
            <div
              className="flex items-center justify-between px-2 py-1 rounded-md cursor-pointer"
              style={{ background: isBatchComplete ? "#dcfce7" : "#f5f3ec" }}
              onClick={() => isBatchComplete && setLocation("/batch-complete")}
              title={isBatchComplete ? "View completed batch" : undefined}
            >
              <span className="text-xs font-semibold" style={{ color: isBatchComplete ? "#16a34a" : "#6b7280" }}>
                Batch {activeBatch}
              </span>
              {isBatchComplete ? (
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: "#bbf7d0", color: "#15803d" }}>Complete ✓</span>
              ) : (
                <span className="text-xs" style={{ color: "#9ca3af" }}>In progress</span>
              )}
            </div>
          </div>
        )}
        {/* Scrollable nav */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* WORKFLOW */}
          <div className="text-xs font-semibold uppercase tracking-widest mb-2 px-1" style={{ color: "#9ca3af" }}>
            Workflow
          </div>
          {WORKFLOW_ITEMS.map(item => {
            const active = isActive(item.path);
            const stageComplete = isStageComplete(item.stage);
            const stageLocked = isStageLocked(item.stage);
            return (
              <button
                key={item.path}
                onClick={() => {
                  if (stageLocked) return;
                  // Business Profile: go to edit mode when stage 1 is already complete
                  if (item.stage === 1 && isStageComplete(1)) {
                    setLocation("/onboarding?edit=1");
                  } else {
                    setLocation(item.path);
                  }
                }}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-md mb-0.5 text-left transition-colors"
                style={{
                  background: active ? "#ede9ff" : "transparent",
                  color: active ? "#6e5afe" : stageLocked ? "#d1d5db" : "#4b5563",
                  cursor: stageLocked ? "default" : "pointer",
                  fontWeight: active ? 600 : 400,
                  fontSize: "13px",
                }}
                onMouseEnter={e => {
                  if (!active && !stageLocked) (e.currentTarget as HTMLButtonElement).style.background = "#f5f3ec";
                }}
                onMouseLeave={e => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                {/* Stage dot */}
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{
                    background: stageComplete ? "#22c55e" : active ? "#6e5afe" : stageLocked ? "#f3f4f6" : "#f3f4f6",
                    color: stageComplete ? "#fff" : active ? "#fff" : "#9ca3af",
                    border: stageLocked ? "1.5px solid #e5e7eb" : "none",
                  }}>
                  {stageComplete ? "✓" : item.num}
                </div>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}

          {/* MANAGE */}
          <div className="text-xs font-semibold uppercase tracking-widest mt-4 mb-2 px-1" style={{ color: "#9ca3af" }}>
            Manage
          </div>
          {MANAGE_ITEMS.map(item => {
            const active = isActive(item.path);
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => setLocation(item.path)}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-md mb-0.5 text-left transition-colors"
                style={{
                  background: active ? "#ede9ff" : "transparent",
                  color: active ? "#6e5afe" : "#4b5563",
                  fontWeight: active ? 600 : 400,
                  fontSize: "13px",
                }}
                onMouseEnter={e => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.background = "#f5f3ec";
                }}
                onMouseLeave={e => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}

          {/* Support */}
          <button
            onClick={() => setLocation("/support")}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-md mb-0.5 text-left transition-colors"
            style={{
              background: isActive("/support") ? "#ede9ff" : "transparent",
              color: isActive("/support") ? "#6e5afe" : "#4b5563",
              fontWeight: isActive("/support") ? 600 : 400,
              fontSize: "13px",
            }}
            onMouseEnter={e => {
              if (!isActive("/support")) (e.currentTarget as HTMLButtonElement).style.background = "#f5f3ec";
            }}
            onMouseLeave={e => {
              if (!isActive("/support")) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            <HelpCircle className="w-4 h-4 flex-shrink-0" />
            <span>Support</span>
          </button>

          {/* Admin */}
          {isAdmin && (
            <button
              onClick={() => setLocation("/admin")}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-md mb-0.5 text-left transition-colors"
              style={{
                background: isActive("/admin") ? "#ede9ff" : "transparent",
                color: isActive("/admin") ? "#6e5afe" : "#4b5563",
                fontWeight: isActive("/admin") ? 600 : 400,
                fontSize: "13px",
              }}
              onMouseEnter={e => {
                if (!isActive("/admin")) (e.currentTarget as HTMLButtonElement).style.background = "#f5f3ec";
              }}
              onMouseLeave={e => {
                if (!isActive("/admin")) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              <Shield className="w-4 h-4 flex-shrink-0" />
              <span>Admin Panel</span>
            </button>
          )}
        </div>

        {/* Bottom: Credits + User */}
        <div className="flex-shrink-0 px-3 py-3" style={{ borderTop: "1px solid #e5e7eb" }}>
          {/* Credits */}
          <div className="rounded-lg p-3 mb-3" style={{ background: "#f5f3ec", border: "1px solid #e5e7eb" }}>
            <div className="text-xs font-medium" style={{ color: "#9ca3af" }}>Authority pack</div>
            <div className="text-sm font-bold mt-0.5" style={{ color: "#1a1a2e" }}>
              {credits} <span className="font-normal text-xs" style={{ color: "#9ca3af" }}>credits</span>
            </div>
            <button
              onClick={() => setLocation("/billing")}
              className="btn-lime mt-2 w-full text-center text-xs py-1.5 rounded-md font-semibold"
            >
              BUY ANOTHER PACK →
            </button>
          </div>
          {/* User row */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: "#6e5afe", color: "white" }}>
              {user?.name?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate" style={{ color: "#1a1a2e" }}>{user?.name ?? "User"}</div>
            </div>
            <button onClick={logout} className="p-1 rounded transition-colors hover:bg-gray-100" title="Sign out">
              <LogOut className="w-3.5 h-3.5" style={{ color: "#9ca3af" }} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <ImpersonationBanner />
      <div className="flex h-screen overflow-hidden" style={{ background: "#faf9f5" }}>
        {/* Desktop sidebar */}
        <div className="hidden md:flex flex-shrink-0 flex-col h-full">
          <SidebarContent />
        </div>

        {/* Mobile sidebar overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
            <div className="absolute left-0 top-0 bottom-0 flex flex-col">
              <SidebarContent />
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* ProDesk Top bar */}
          <div className="flex items-center justify-between px-4 h-12 flex-shrink-0"
            style={{ background: "#ffffff", borderBottom: "1px solid #e5e7eb" }}>
            <div className="flex items-center gap-3">
              {/* Mobile hamburger */}
              <button className="md:hidden p-1.5 rounded" onClick={() => setMobileOpen(v => !v)}>
                {mobileOpen
                  ? <X className="w-4 h-4" style={{ color: "#6b7280" }} />
                  : <Menu className="w-4 h-4" style={{ color: "#6b7280" }} />
                }
              </button>
              {/* ProDesk wordmark */}
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "#6e5afe" }}>
                  <span className="text-white font-bold" style={{ fontSize: "9px" }}>P</span>
                </div>
                <span className="font-bold text-sm" style={{ color: "#1a1a2e" }}>ProDesk</span>
              </div>
              <span className="text-xs hidden sm:inline" style={{ color: "#d1d5db" }}>·</span>
              <span className="text-xs font-semibold uppercase tracking-wide hidden sm:inline" style={{ color: "#9ca3af" }}>
                Suite / <span style={{ color: "#1a1a2e" }}>Blog Batcher</span>
              </span>
            </div>

            {/* Search */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg flex-1 max-w-xs mx-4"
              style={{ background: "#f5f3ec", border: "1px solid #e5e7eb" }}>
              <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#9ca3af" }} />
              <input
                type="text"
                placeholder="Search articles, keywords…"
                className="bg-transparent text-xs outline-none flex-1"
                style={{ color: "#4b5563" }}
              />
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "#e5e7eb", color: "#9ca3af" }}>⌘K</span>
            </div>

            {/* Right: All Apps + Avatar */}
            <div className="flex items-center gap-2">
              <button className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: "#f5f3ec", border: "1px solid #e5e7eb", color: "#4b5563" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#ede9de")}
                onMouseLeave={e => (e.currentTarget.style.background = "#f5f3ec")}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                ALL APPS
              </button>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: "#6e5afe", color: "white" }}>
                {user?.name?.slice(0, 2).toUpperCase() ?? "MR"}
              </div>
            </div>
          </div>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
