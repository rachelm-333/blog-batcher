import { trpc } from "@/lib/trpc";
import { Eye, X } from "lucide-react";
import { toast } from "sonner";

export default function ImpersonationBanner() {
  const impersonationQuery = trpc.admin.getImpersonationStatus.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const stopMutation = trpc.admin.stopImpersonation.useMutation({
    onSuccess: () => {
      toast.success("Impersonation ended. Returning to admin session.");
      setTimeout(() => (window.location.href = "/admin"), 1000);
    },
    onError: (e) => toast.error(e.message),
  });

  if (!impersonationQuery.data?.isImpersonating) return null;

  const adminUserId = impersonationQuery.data?.adminUserId;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between shadow-lg">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Eye className="h-4 w-4" />
        <span>
          ⚠️ IMPERSONATION ACTIVE — You are viewing the app as another user.
          {adminUserId != null && ` Admin ID: #${adminUserId}`}
        </span>
      </div>
      <button
        className="bg-amber-950 text-amber-50 border border-amber-900 hover:bg-amber-900 px-3 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-colors"
        onClick={() => stopMutation.mutate()}
        disabled={stopMutation.isPending}
      >
        <X className="h-3 w-3" /> Stop Impersonating
      </button>
    </div>
  );
}
