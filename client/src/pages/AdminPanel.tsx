/**
 * AdminPanel.tsx
 * Layer 12 — Admin Panel
 *
 * Accessible only to rachel.m@noize.com.au or users with role="admin".
 * All other users are redirected to / with a 403 toast.
 *
 * Tabs:
 *   Users        — list, suspend/unsuspend, add/remove credits
 *   Businesses   — all businesses with user info and article counts
 *   Revenue      — total payments, refunds, credit top-ups from DB
 *   Error Log    — app_error_log entries
 *   API Costs    — api_cost_log aggregated by user and day
 *   Audit Log    — publish_audit_log (Layer 9)
 *   Admin Log    — admin_log entries
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Ban,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  DollarSign,
  Eye,
  Minus,
  Plus,
  RefreshCw,
  Shield,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const ADMIN_EMAIL = "rachel.m@noize.com.au";

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Users Tab
// ---------------------------------------------------------------------------
function UsersTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [creditDialog, setCreditDialog] = useState<{
    userId: number;
    userName: string;
    currentBalance: number;
    mode: "add" | "remove";
  } | null>(null);
  const [creditAmount, setCreditAmount] = useState("10");
  const [creditReason, setCreditReason] = useState("");
  const [impersonateDialog, setImpersonateDialog] = useState<{
    userId: number;
    userName: string;
  } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, refetch } = trpc.admin.listUsers.useQuery({
    page,
    limit: 50,
    search: debouncedSearch || undefined,
  });

  const suspendMutation = trpc.admin.suspendUser.useMutation({
    onSuccess: () => { toast.success("User suspended"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const unsuspendMutation = trpc.admin.unsuspendUser.useMutation({
    onSuccess: () => { toast.success("User unsuspended"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const addCreditsMutation = trpc.admin.addCredits.useMutation({
    onSuccess: (d) => {
      toast.success(`Credits updated. New balance: ${d.newBalance}`);
      setCreditDialog(null);
      setCreditAmount("10");
      setCreditReason("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const removeCreditsMutation = trpc.admin.removeCredits.useMutation({
    onSuccess: (d) => {
      toast.success(`Credits updated. New balance: ${d.newBalance}`);
      setCreditDialog(null);
      setCreditAmount("10");
      setCreditReason("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const startImpersonationMutation = trpc.admin.startImpersonation.useMutation({
    onSuccess: (d) => {
      toast.success(`Now viewing app as ${d.targetUser.name ?? d.targetUser.email}. Refresh to see their view.`);
      setImpersonateDialog(null);
      // Reload to apply the new session cookie
      setTimeout(() => window.location.href = "/dashboard", 1000);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleCreditSubmit = () => {
    const amount = parseInt(creditAmount, 10);
    if (!creditDialog || isNaN(amount) || amount < 1) return;
    if (creditDialog.mode === "add") {
      addCreditsMutation.mutate({ userId: creditDialog.userId, amount, reason: creditReason || undefined });
    } else {
      removeCreditsMutation.mutate({ userId: creditDialog.userId, amount, reason: creditReason || undefined });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
        <span className="text-sm text-muted-foreground ml-auto">
          {data?.total ?? 0} users total
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Businesses</TableHead>
                <TableHead>Articles</TableHead>
                <TableHead>Last Active</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.users ?? []).map((u) => (
                <TableRow key={u.id} className={u.isSuspended ? "opacity-60" : ""}>
                  <TableCell className="font-mono text-xs">{u.id}</TableCell>
                  <TableCell>{u.name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{u.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                      {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell>{u.creditBalance}</TableCell>
                  <TableCell>{u.businessCount}</TableCell>
                  <TableCell>{u.articleCount}</TableCell>
                  <TableCell className="text-xs">{formatDate(u.lastSignedIn)}</TableCell>
                  <TableCell>
                    {u.isSuspended ? (
                      <Badge variant="destructive">Suspended</Badge>
                    ) : (
                      <Badge variant="outline" className="text-green-600 border-green-600">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {u.isSuspended ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => unsuspendMutation.mutate({ userId: u.id })}
                          disabled={unsuspendMutation.isPending}
                          title="Unsuspend user"
                        >
                          <UserCheck className="h-3 w-3" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
                          onClick={() => suspendMutation.mutate({ userId: u.id })}
                          disabled={suspendMutation.isPending}
                          title="Suspend user"
                        >
                          <Ban className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-600 border-green-600"
                        onClick={() => {
                          setCreditDialog({ userId: u.id, userName: u.name ?? u.email ?? "User", currentBalance: u.creditBalance, mode: "add" });
                          setCreditAmount("10");
                          setCreditReason("");
                        }}
                        title="Add credits"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-orange-600 border-orange-600"
                        onClick={() => {
                          setCreditDialog({ userId: u.id, userName: u.name ?? u.email ?? "User", currentBalance: u.creditBalance, mode: "remove" });
                          setCreditAmount("10");
                          setCreditReason("");
                        }}
                        title="Remove credits"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setImpersonateDialog({ userId: u.id, userName: u.name ?? u.email ?? "User" })}
                        title="View app as this user"
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(data?.users ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    No users found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm">Page {page}</span>
        <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(data?.users ?? []).length < 50}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Credit Dialog */}
      <Dialog open={!!creditDialog} onOpenChange={(o) => !o && setCreditDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {creditDialog?.mode === "add" ? "Add Credits" : "Remove Credits"} — {creditDialog?.userName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Current balance: <strong>{creditDialog?.currentBalance}</strong> credits
            </p>
            <div className="space-y-1">
              <Label>Amount</Label>
              <Input
                type="number"
                min={1}
                max={10000}
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Reason (optional)</Label>
              <Textarea
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value)}
                placeholder="e.g. Compensation for generation failure"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditDialog(null)}>Cancel</Button>
            <Button
              onClick={handleCreditSubmit}
              disabled={addCreditsMutation.isPending || removeCreditsMutation.isPending}
              className={creditDialog?.mode === "remove" ? "bg-orange-600 hover:bg-orange-700" : ""}
            >
              {creditDialog?.mode === "add" ? "Add Credits" : "Remove Credits"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Impersonation Dialog */}
      <Dialog open={!!impersonateDialog} onOpenChange={(o) => !o && setImpersonateDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Impersonate User</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">You are about to impersonate <strong>{impersonateDialog?.userName}</strong>.</p>
                <p className="mt-1">A banner will be shown at the top of every page while impersonation is active. Your session will be replaced for up to 2 hours.</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImpersonateDialog(null)}>Cancel</Button>
            <Button
              onClick={() => impersonateDialog && startImpersonationMutation.mutate({ targetUserId: impersonateDialog.userId })}
              disabled={startImpersonationMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              <Eye className="h-4 w-4 mr-2" /> Start Impersonation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Businesses Tab
// ---------------------------------------------------------------------------
function BusinessesTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = trpc.admin.listBusinesses.useQuery({
    page,
    limit: 50,
    search: debouncedSearch || undefined,
  });

  const STAGE_LABELS = ["", "Business Profile", "Architecture", "Keywords", "Generation", "Review & Publish"];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by business name or user email..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
        <span className="text-sm text-muted-foreground ml-auto">{data?.total ?? 0} businesses total</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Business Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Articles</TableHead>
                <TableHead>Test</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.businesses ?? []).map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">{b.id}</TableCell>
                  <TableCell className="font-medium">{b.name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{b.industry ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    <div>{b.userName ?? "—"}</div>
                    <div className="text-muted-foreground">{b.userEmail ?? "—"}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">Stage {b.currentStage}: {STAGE_LABELS[b.currentStage ?? 1] ?? "Unknown"}</Badge>
                  </TableCell>
                  <TableCell>{b.articleCount}</TableCell>
                  <TableCell>
                    {b.isTestBusiness && <Badge variant="secondary">Test</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">{formatDate(b.createdAt)}</TableCell>
                </TableRow>
              ))}
              {(data?.businesses ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No businesses found</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex items-center gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm">Page {page}</span>
        <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(data?.businesses ?? []).length < 50}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue Tab
// ---------------------------------------------------------------------------
function RevenueTab() {
  const { data, isLoading } = trpc.admin.getRevenueSummary.useQuery();

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Payments</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">${data?.totalPaymentsUsd.toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">{data?.paymentCount} transactions</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Refunds</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">${data?.totalRefundsUsd.toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">{data?.refundCount} refunds</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Credit Top-Ups</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data?.totalCreditTopUps}</div>
                <div className="text-xs text-muted-foreground">credits purchased</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Admin Grants</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600">{data?.adminCreditGrants}</div>
                <div className="text-xs text-muted-foreground">credits granted manually</div>
              </CardContent>
            </Card>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3">Recent Payments</h3>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.recentPayments ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.id}</TableCell>
                      <TableCell className="text-xs">
                        <div>{p.userName ?? "—"}</div>
                        <div className="text-muted-foreground">{p.userEmail ?? "—"}</div>
                      </TableCell>
                      <TableCell>{formatCents(p.amountCents)} {p.currency?.toUpperCase()}</TableCell>
                      <TableCell><Badge variant="outline">{p.product}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={p.status === "succeeded" ? "default" : p.status === "refunded" ? "destructive" : "secondary"}>
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(p.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                  {(data?.recentPayments ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No payments yet</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error Log Tab
// ---------------------------------------------------------------------------
function ErrorLogTab() {
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading, refetch } = trpc.admin.listErrorLog.useQuery({ page, limit: 50 });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
        <span className="text-sm text-muted-foreground ml-auto">{data?.total ?? 0} errors total</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Stack</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.errors ?? []).map((e) => (
                <>
                  <TableRow key={e.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}>
                    <TableCell className="font-mono text-xs">{e.id}</TableCell>
                    <TableCell className="text-xs">{formatDate(e.createdAt)}</TableCell>
                    <TableCell className="text-xs">{e.userEmail ?? (e.userId ? `#${e.userId}` : "System")}</TableCell>
                    <TableCell className="text-xs font-mono">{e.route ?? "—"}</TableCell>
                    <TableCell className="text-xs max-w-xs truncate">{e.errorMessage}</TableCell>
                    <TableCell>
                      {e.stackTrace && (
                        <Badge variant="outline" className="cursor-pointer text-xs">
                          {expandedId === e.id ? "Hide" : "Show"}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                  {expandedId === e.id && e.stackTrace && (
                    <TableRow key={`${e.id}-stack`}>
                      <TableCell colSpan={6} className="bg-muted/30">
                        <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto p-2">
                          {e.stackTrace}
                        </pre>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
              {(data?.errors ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    <div className="flex flex-col items-center gap-2">
                      <CheckCircle className="h-8 w-8 text-green-500" />
                      <span>No errors logged — all systems healthy</span>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex items-center gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm">Page {page}</span>
        <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(data?.errors ?? []).length < 50}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Costs Tab
// ---------------------------------------------------------------------------
function ApiCostsTab() {
  const [page, setPage] = useState(1);
  const [daysBack, setDaysBack] = useState(30);

  const { data, isLoading } = trpc.admin.listApiCostLog.useQuery({ page, limit: 50, daysBack });

  const totalCost = data?.byUser.reduce((sum, u) => sum + u.totalCostUsd, 0) ?? 0;
  const totalCalls = data?.byUser.reduce((sum, u) => sum + u.callCount, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <select
          value={daysBack}
          onChange={(e) => setDaysBack(Number(e.target.value))}
          className="text-sm border rounded px-2 py-1 bg-background"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <span className="text-sm text-muted-foreground ml-auto">
          Total: ${totalCost.toFixed(4)} USD across {totalCalls} calls
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : (
        <>
          <div>
            <h3 className="text-sm font-semibold mb-3">By User</h3>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Calls</TableHead>
                    <TableHead>Input Tokens</TableHead>
                    <TableHead>Output Tokens</TableHead>
                    <TableHead>Est. Cost (USD)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.byUser.map((u, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">
                        <div>{u.userName ?? "—"}</div>
                        <div className="text-muted-foreground">{u.userEmail ?? `#${u.userId}`}</div>
                      </TableCell>
                      <TableCell>{u.callCount}</TableCell>
                      <TableCell>{u.totalInputTokens.toLocaleString()}</TableCell>
                      <TableCell>{u.totalOutputTokens.toLocaleString()}</TableCell>
                      <TableCell className="font-mono">${u.totalCostUsd.toFixed(4)}</TableCell>
                    </TableRow>
                  ))}
                  {(data?.byUser ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No API calls logged yet</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3">By Day</h3>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Calls</TableHead>
                    <TableHead>Total Tokens</TableHead>
                    <TableHead>Est. Cost (USD)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.byDay.map((d, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{d.day}</TableCell>
                      <TableCell>{d.callCount}</TableCell>
                      <TableCell>{d.totalTokens.toLocaleString()}</TableCell>
                      <TableCell className="font-mono">${d.totalCostUsd.toFixed(4)}</TableCell>
                    </TableRow>
                  ))}
                  {(data?.byDay ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No data</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3">Recent API Calls</h3>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Feature</TableHead>
                    <TableHead>Input</TableHead>
                    <TableHead>Output</TableHead>
                    <TableHead>Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.entries ?? []).map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{formatDate(e.createdAt)}</TableCell>
                      <TableCell className="text-xs">{e.userEmail ?? `#${e.userId}`}</TableCell>
                      <TableCell className="text-xs font-mono">{e.model}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{e.feature}</Badge></TableCell>
                      <TableCell>{e.inputTokens.toLocaleString()}</TableCell>
                      <TableCell>{e.outputTokens.toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">${Number(e.estimatedCostUsd).toFixed(4)}</TableCell>
                    </TableRow>
                  ))}
                  {(data?.entries ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No API calls logged yet</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit Log Tab (Layer 9 publish_audit_log)
// ---------------------------------------------------------------------------
function AuditLogTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = trpc.admin.listPublishAuditLog.useQuery({ page, limit: 50 });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
        <span className="text-sm text-muted-foreground ml-auto">{data?.total ?? 0} entries total</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Article</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Attempt</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.entries ?? []).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">{formatDate(e.createdAt)}</TableCell>
                  <TableCell className="text-xs">{e.userEmail ?? "—"}</TableCell>
                  <TableCell className="text-xs">{e.businessName ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-[120px] truncate">{e.articleTitle ?? `#${e.articleId}`}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{e.action}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={e.result === "success" ? "default" : "destructive"} className="text-xs">
                      {e.result}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">{e.attemptNumber}</TableCell>
                  <TableCell className="text-xs max-w-[150px] truncate text-destructive">{e.errorMessage ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(data?.entries ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No audit log entries yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex items-center gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm">Page {page}</span>
        <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(data?.entries ?? []).length < 50}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin Log Tab
// ---------------------------------------------------------------------------
function AdminLogTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = trpc.admin.listAdminLog.useQuery({ page, limit: 50 });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
        <span className="text-sm text-muted-foreground ml-auto">{data?.total ?? 0} entries total</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target User</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.entries ?? []).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">{formatDate(e.createdAt)}</TableCell>
                  <TableCell className="text-xs">
                    <div>{e.adminName ?? "—"}</div>
                    <div className="text-muted-foreground">{e.adminEmail ?? "—"}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{e.action}</Badge></TableCell>
                  <TableCell className="text-xs">{e.targetUserId ? `#${e.targetUserId}` : "—"}</TableCell>
                  <TableCell className="text-xs max-w-xs truncate">{e.notes ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(data?.entries ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No admin actions logged yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex items-center gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm">Page {page}</span>
        <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(data?.entries ?? []).length < 50}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Impersonation Banner
// ---------------------------------------------------------------------------
function ImpersonationBanner({ adminUserId }: { adminUserId: number }) {
  const stopMutation = trpc.admin.stopImpersonation.useMutation({
    onSuccess: () => {
      toast.success("Impersonation ended. Returning to admin session.");
      setTimeout(() => window.location.href = "/admin", 1000);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between shadow-lg">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Eye className="h-4 w-4" />
        <span>⚠️ IMPERSONATION ACTIVE — You are viewing the app as another user. Admin ID: #{adminUserId}</span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="bg-amber-950 text-amber-50 border-amber-950 hover:bg-amber-900 h-7 text-xs"
        onClick={() => stopMutation.mutate()}
        disabled={stopMutation.isPending}
      >
        <X className="h-3 w-3 mr-1" /> Stop Impersonating
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Admin Panel
// ---------------------------------------------------------------------------
export default function AdminPanel() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  const impersonationQuery = trpc.admin.getImpersonationStatus.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const isAdmin = user && (user.role === "admin" || user.email === ADMIN_EMAIL);

  useEffect(() => {
    if (!loading && !isAdmin) {
      toast.error("Access denied. Admin privileges required.", { duration: 5000 });
      navigate("/dashboard");
    }
  }, [loading, isAdmin, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <>
      {impersonationQuery.data?.isImpersonating && impersonationQuery.data?.adminUserId != null && (
        <ImpersonationBanner adminUserId={impersonationQuery.data.adminUserId} />
      )}

      <div className={`min-h-screen bg-background ${impersonationQuery.data?.isImpersonating ? "pt-10" : ""}`}>
        <div className="border-b bg-card">
          <div className="container mx-auto px-6 py-4 flex items-center gap-3">
            <Shield className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold">Admin Panel</h1>
              <p className="text-xs text-muted-foreground">Blog Batcher — Internal Operations</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                Logged in as: {user.email}
              </Badge>
              <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>
                ← Back to App
              </Button>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-6 py-6">
          <Tabs defaultValue="users">
            <TabsList className="mb-6 flex-wrap h-auto gap-1">
              <TabsTrigger value="users" className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> Users
              </TabsTrigger>
              <TabsTrigger value="businesses">Businesses</TabsTrigger>
              <TabsTrigger value="revenue">
                <DollarSign className="h-3.5 w-3.5" /> Revenue
              </TabsTrigger>
              <TabsTrigger value="errors">
                <AlertTriangle className="h-3.5 w-3.5" /> Error Log
              </TabsTrigger>
              <TabsTrigger value="api-costs">
                <CreditCard className="h-3.5 w-3.5" /> API Costs
              </TabsTrigger>
              <TabsTrigger value="audit-log">Audit Log</TabsTrigger>
              <TabsTrigger value="admin-log">Admin Log</TabsTrigger>
            </TabsList>

            <TabsContent value="users"><UsersTab /></TabsContent>
            <TabsContent value="businesses"><BusinessesTab /></TabsContent>
            <TabsContent value="revenue"><RevenueTab /></TabsContent>
            <TabsContent value="errors"><ErrorLogTab /></TabsContent>
            <TabsContent value="api-costs"><ApiCostsTab /></TabsContent>
            <TabsContent value="audit-log"><AuditLogTab /></TabsContent>
            <TabsContent value="admin-log"><AdminLogTab /></TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
