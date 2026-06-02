import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  LayoutDashboard, LogOut, FileText, BarChart2, Pencil,
  Users, Calendar, Puzzle, HelpCircle, CreditCard, Shield,
  ChevronDown, Plus, Zap, Menu, X, Bell
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { NotificationBell } from "./NotificationBell";
import ImpersonationBanner from "./ImpersonationBanner";

/* ─── Nav structure matching mockup ─────────────────────── */
const PIPELINE_ITEMS = [
  { num: 1, label: "Business Profile",   path: "/onboarding",    stage: 1 },
  { num: 2, label: "Blog Architecture",  path: "/architecture",  stage: 2 },
  { num: 3, label: "Keyword Research",   path: "/keywords",      stage: 3 },
  { num: 4, label: "Article Generation", path: "/generate",      stage: 4 },
  { num: 5, label: "Review & Edit",      path: "/review",        stage: 5 },
  { num: 6, label: "Publish & Schedule", path: "/publish",       stage: 6 },
];

const TOOL_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard",          path: "/dashboard" },
  { icon: Calendar,        label: "Schedule Mgmt",      path: "/schedule-management" },
  { icon: Puzzle,          label: "Integrations",       path: "/integrations" },
];

const ACCOUNT_ITEMS = [
  { icon: HelpCircle, label: "Help & Support", path: "/support" },
  { icon: CreditCard, label: "Billing",         path: "/billing" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--navy)" }}
      >
        <div className="flex flex-col items-center gap-6 p-8 max-w-sm w-full text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-2"
            style={{ background: "rgba(108,99,255,0.15)", border: "1px solid rgba(108,99,255,0.3)" }}
          >
            <Shield className="w-8 h-8" style={{ color: "var(--purple)" }} />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--white)" }}>
            Sign in to continue
          </h1>
          <p className="text-sm" style={{ color: "var(--text2)" }}>
            Access to this dashboard requires authentication.
          </p>
          <button
            onClick={() => { window.location.href = getLoginUrl(); }}
            className="w-full py-3 px-6 rounded-lg font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: "var(--purple)" }}
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

  // Fetch business list for the sidebar business badge
  const { data: businesses } = trpc.dashboard.listBusinesses.useQuery();
  const [selectedBizId, setSelectedBizId] = useState<number | null>(null);
  const [bizDropOpen, setBizDropOpen] = useState(false);
  const bizRef = useRef<HTMLDivElement>(null);

  // Credits
  const { data: creditData } = trpc.payments.getBalance.useQuery();
  const credits = creditData?.balance ?? 0;

  const activeBiz = businesses?.find(b => b.id === selectedBizId) ?? businesses?.[0];

  useEffect(() => {
    if (businesses && businesses.length > 0 && !selectedBizId) {
      setSelectedBizId(businesses[0].id);
    }
  }, [businesses, selectedBizId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bizRef.current && !bizRef.current.contains(e.target as Node)) {
        setBizDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close mobile nav on route change
  useEffect(() => { setMobileOpen(false); }, [location]);

  const isActive = (path: string) => location === path || location.startsWith(path + "/");

  const SidebarContent = () => (
    <div
      className="flex flex-col h-full"
      style={{ background: "var(--navy2)", borderRight: "1px solid var(--border-col)" }}
    >
      {/* Logo */}
      <div
        className="px-5 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-col)" }}
      >
        <div className="font-bold text-lg" style={{ color: "var(--white)" }}>
          Blog Batcher
        </div>
        <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>
          SEO Content Platform
        </div>
      </div>

      {/* Business Badge */}
      {activeBiz && (
        <div className="px-4 py-3 flex-shrink-0" ref={bizRef}>
          <div
            className="rounded-lg p-3 cursor-pointer relative"
            style={{ background: "var(--navy3)", border: "1px solid var(--border-col)" }}
            onClick={() => setBizDropOpen(v => !v)}
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate" style={{ color: "var(--white)" }}>
                  {activeBiz.name}
                </div>
                <div className="text-xs truncate mt-0.5" style={{ color: "var(--text2)" }}>
                  {activeBiz.websiteUrl || "No URL set"}
                </div>
              </div>
              <ChevronDown
                className="w-4 h-4 flex-shrink-0 ml-2 transition-transform"
                style={{ color: "var(--text2)", transform: bizDropOpen ? "rotate(180deg)" : "none" }}
              />
            </div>
            {/* Stage progress bar */}
            <div
              className="mt-2 rounded h-1"
              style={{ background: "var(--border-col)" }}
            >
              <div
                className="h-1 rounded transition-all"
                style={{
                  background: "var(--purple)",
                  width: `${Math.min(100, ((activeBiz.currentStage ?? 1) / 6) * 100)}%`
                }}
              />
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--text2)" }}>
              Stage {activeBiz.currentStage ?? 1} of 6
            </div>

            {/* Business dropdown */}
            {bizDropOpen && (
              <div
                className="absolute left-0 right-0 top-full mt-1 rounded-lg overflow-hidden z-50 shadow-xl"
                style={{ background: "var(--navy3)", border: "1px solid var(--border-col)" }}
              >
                {businesses?.map(biz => (
                  <div
                    key={biz.id}
                    className="px-3 py-2.5 cursor-pointer hover:bg-card/5 transition-colors"
                    style={{
                      borderBottom: "1px solid var(--border-col)",
                      background: biz.id === selectedBizId ? "rgba(108,99,255,0.1)" : undefined
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedBizId(biz.id);
                      setBizDropOpen(false);
                    }}
                  >
                    <div className="text-sm font-medium" style={{ color: "var(--white)" }}>
                      {biz.name}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>
                      Stage {biz.currentStage ?? 1} of 6
                    </div>
                  </div>
                ))}
                <div
                  className="px-3 py-2.5 cursor-pointer hover:bg-card/5 transition-colors flex items-center gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    setBizDropOpen(false);
                    setLocation("/onboarding?new=1");
                  }}
                >
                  <Plus className="w-3.5 h-3.5" style={{ color: "var(--purple)" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--purple)" }}>
                    Add New Business
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Scrollable nav */}
      <div className="flex-1 overflow-y-auto px-2 py-1">

        {/* PIPELINE */}
        <div
          className="px-2 py-1.5 text-xs font-bold tracking-widest uppercase"
          style={{ color: "var(--text2)" }}
        >
          Pipeline
        </div>
        {PIPELINE_ITEMS.map(item => {
          const active = isActive(item.path);
          const stageComplete = activeBiz ? (activeBiz.currentStage ?? 1) > item.stage : false;
          const stageLocked  = activeBiz ? (activeBiz.currentStage ?? 1) < item.stage : item.stage > 1;
          return (
            <button
              key={item.path}
              onClick={() => !stageLocked && setLocation(item.path)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md mb-0.5 text-sm font-medium transition-all text-left"
              style={{
                background: active ? "var(--purple)" : "transparent",
                color: active ? "var(--white)" : stageLocked ? "var(--text2)" : "var(--text2)",
                opacity: stageLocked ? 0.45 : 1,
                cursor: stageLocked ? "default" : "pointer",
              }}
              onMouseEnter={e => {
                if (!active && !stageLocked) {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--navy3)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--white)";
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.color = stageLocked ? "var(--text2)" : "var(--text2)";
                }
              }}
            >
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{
                  background: active ? "rgba(255,255,255,0.2)" : stageComplete ? "rgba(34,197,94,0.2)" : "var(--border-col)",
                  color: active ? "white" : stageComplete ? "var(--green)" : "var(--text2)",
                }}
              >
                {stageComplete ? "✓" : item.num}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}

        {/* TOOLS */}
        <div
          className="px-2 py-1.5 mt-3 text-xs font-bold tracking-widest uppercase"
          style={{ color: "var(--text2)" }}
        >
          Tools
        </div>
        {TOOL_ITEMS.map(item => {
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md mb-0.5 text-sm font-medium transition-all text-left"
              style={{
                background: active ? "var(--purple)" : "transparent",
                color: active ? "var(--white)" : "var(--text2)",
              }}
              onMouseEnter={e => {
                if (!active) {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--navy3)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--white)";
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--text2)";
                }
              }}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}

        {/* ACCOUNT */}
        <div
          className="px-2 py-1.5 mt-3 text-xs font-bold tracking-widest uppercase"
          style={{ color: "var(--text2)" }}
        >
          Account
        </div>
        {ACCOUNT_ITEMS.map(item => {
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md mb-0.5 text-sm font-medium transition-all text-left"
              style={{
                background: active ? "var(--purple)" : "transparent",
                color: active ? "var(--white)" : "var(--text2)",
              }}
              onMouseEnter={e => {
                if (!active) {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--navy3)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--white)";
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--text2)";
                }
              }}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}

        {/* Admin link */}
        {isAdmin && (
          <>
            <div
              className="px-2 py-1.5 mt-3 text-xs font-bold tracking-widest uppercase"
              style={{ color: "var(--text2)" }}
            >
              Admin
            </div>
            <button
              onClick={() => setLocation("/admin")}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md mb-0.5 text-sm font-medium transition-all text-left"
              style={{
                background: isActive("/admin") ? "var(--purple)" : "transparent",
                color: isActive("/admin") ? "var(--white)" : "var(--text2)",
              }}
              onMouseEnter={e => {
                if (!isActive("/admin")) {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--navy3)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--white)";
                }
              }}
              onMouseLeave={e => {
                if (!isActive("/admin")) {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--text2)";
                }
              }}
            >
              <Shield className="w-4 h-4 flex-shrink-0" />
              <span>Admin Panel</span>
            </button>
          </>
        )}
      </div>

      {/* Bottom: Credits + User */}
      <div
        className="flex-shrink-0 p-4"
        style={{ borderTop: "1px solid var(--border-col)" }}
      >
        {/* Credits box */}
        <div
          className="rounded-lg p-3 mb-3"
          style={{ background: "var(--navy3)", border: "1px solid var(--border-col)" }}
        >
          <div className="text-xs" style={{ color: "var(--text2)" }}>Available Credits</div>
          <div className="text-2xl font-bold mt-0.5" style={{ color: "var(--purple)" }}>
            {credits}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>
            article generation credits
          </div>
          <button
            onClick={() => setLocation("/billing")}
            className="mt-2 w-full text-xs py-1.5 rounded-md font-semibold transition-all hover:opacity-90"
            style={{ background: "rgba(108,99,255,0.15)", color: "var(--purple)", border: "1px solid rgba(108,99,255,0.3)" }}
          >
            Top Up Credits
          </button>
        </div>

        {/* User row */}
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{ background: "var(--purple)", color: "white" }}
          >
            {user?.name?.charAt(0).toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate" style={{ color: "var(--white)" }}>
              {user?.name ?? "User"}
            </div>
            <div className="text-xs truncate" style={{ color: "var(--text2)" }}>
              {user?.email ?? ""}
            </div>
          </div>
          <button
            onClick={logout}
            className="p-1.5 rounded-md transition-colors hover:bg-card/10"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" style={{ color: "var(--text2)" }} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <ImpersonationBanner />

      <div className="flex h-screen overflow-hidden" style={{ background: "var(--navy)" }}>
        {/* Desktop sidebar */}
        <div className="hidden md:flex w-64 flex-shrink-0 flex-col h-full">
          <SidebarContent />
        </div>

        {/* Mobile sidebar overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileOpen(false)}
            />
            <div className="absolute left-0 top-0 bottom-0 w-64 flex flex-col">
              <SidebarContent />
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Top bar */}
          <div
            className="flex items-center justify-between px-4 h-14 flex-shrink-0"
            style={{ background: "var(--navy2)", borderBottom: "1px solid var(--border-col)" }}
          >
            <div className="flex items-center gap-3">
              {/* Mobile hamburger */}
              <button
                className="md:hidden p-2 rounded-md"
                onClick={() => setMobileOpen(v => !v)}
              >
                {mobileOpen
                  ? <X className="w-5 h-5" style={{ color: "var(--text2)" }} />
                  : <Menu className="w-5 h-5" style={{ color: "var(--text2)" }} />
                }
              </button>
              <span className="text-sm font-semibold" style={{ color: "var(--white)" }}>
                {PIPELINE_ITEMS.find(i => isActive(i.path))?.label
                  ?? TOOL_ITEMS.find(i => isActive(i.path))?.label
                  ?? ACCOUNT_ITEMS.find(i => isActive(i.path))?.label
                  ?? "Blog Batcher"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
            </div>
          </div>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
