import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
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

      {/* Authenticated app */}
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/architecture" component={Architecture} />
      <Route path="/keywords" component={Keywords} />
      <Route path="/content-plan" component={ContentPlan} />
      <Route path="/generate" component={ArticleGeneration} />
      <Route path="/review" component={ArticleReview} />
      <Route path="/publish" component={PublishSchedule} />
      <Route path="/integrations" component={Integrations} />
      <Route path="/schedule-management" component={ScheduleManagement} />
      <Route path="/support" component={SupportCentre} />
      <Route path="/admin" component={AdminPanel} />
      <Route path="/billing" component={Billing} />
      <Route path="/payment-success" component={PaymentSuccess} />
      <Route path="/payment-cancelled" component={PaymentCancelled} />
      <Route path="/free-trial" component={FreeTrial} />
      <Route path="/batch-complete" component={BatchComplete} />

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
