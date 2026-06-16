import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useActiveBusiness } from "./contexts/BusinessContext";
import Architecture from "./pages/Architecture";
import Dashboard from "./pages/Dashboard";
import Keywords from "./pages/Keywords";
import ArticleGeneration from "./pages/ArticleGeneration";
import ContentPlan from "./pages/ContentPlan";
import ArticleReview from "./pages/ArticleReview";
import PublishSchedule from "./pages/PublishSchedule";
import Integrations from "./pages/Integrations";
import ScheduleManagement from "./pages/ScheduleManagement";
import SupportCentre from "./pages/SupportCentre";
import AdminPanel from "./pages/AdminPanel";
import Billing from "./pages/Billing";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentCancelled from "./pages/PaymentCancelled";
import FreeTrial from "./pages/FreeTrial";
import BatchComplete from "./pages/BatchComplete";
import ForgotPassword from "./pages/ForgotPassword";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import Register from "./pages/Register";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";

/**
 * KeyedByBusiness wraps a page component and remounts it whenever the active
 * business changes, resetting all local state and tRPC query caches.
 */
function KeyedByBusiness({ Page }: { Page: React.ComponentType }) {
  const { selectedBizId } = useActiveBusiness();
  return <Page key={selectedBizId ?? "none"} />;
}

function Router() {
  return (
    <Switch>
      {/* Public landing */}
      <Route path="/" component={Home} />

      {/* Auth flows */}
      <Route path="/register" component={Register} />
      <Route path="/login" component={Login} />
      <Route path="/verify-email" component={VerifyEmail} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />

      {/* Authenticated app — pages keyed by business so they remount on switch */}
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/admin" component={AdminPanel} />
      <Route path="/dashboard">{() => <KeyedByBusiness Page={Dashboard} />}</Route>
      <Route path="/architecture">{() => <KeyedByBusiness Page={Architecture} />}</Route>
      <Route path="/keywords">{() => <KeyedByBusiness Page={Keywords} />}</Route>
      <Route path="/content-plan">{() => <KeyedByBusiness Page={ContentPlan} />}</Route>
      <Route path="/generate">{() => <KeyedByBusiness Page={ArticleGeneration} />}</Route>
      <Route path="/review">{() => <KeyedByBusiness Page={ArticleReview} />}</Route>
      <Route path="/publish">{() => <KeyedByBusiness Page={PublishSchedule} />}</Route>
      <Route path="/integrations">{() => <KeyedByBusiness Page={Integrations} />}</Route>
      <Route path="/schedule-management">{() => <KeyedByBusiness Page={ScheduleManagement} />}</Route>
      <Route path="/support">{() => <KeyedByBusiness Page={SupportCentre} />}</Route>
      <Route path="/billing">{() => <KeyedByBusiness Page={Billing} />}</Route>
      <Route path="/payment-success">{() => <KeyedByBusiness Page={PaymentSuccess} />}</Route>
      <Route path="/payment-cancelled">{() => <KeyedByBusiness Page={PaymentCancelled} />}</Route>
      <Route path="/free-trial">{() => <KeyedByBusiness Page={FreeTrial} />}</Route>
      <Route path="/batch-complete">{() => <KeyedByBusiness Page={BatchComplete} />}</Route>

      {/* Fallback */}
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
