import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import PatientsPage from "@/pages/PatientsPage";
import PatientDetailPage from "@/pages/PatientDetailPage";
import ProfessionalsPage from "@/pages/ProfessionalsPage";
import SchedulePage from "@/pages/SchedulePage";
import ReceptionPage from "@/pages/ReceptionPage";
import MedicalRecordsPage from "@/pages/MedicalRecordsPage";
import FinancialPage from "@/pages/FinancialPage";
import SettingsPage from "@/pages/SettingsPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<AppLayout><DashboardPage /></AppLayout>} />
            <Route path="/patients" element={<AppLayout><PatientsPage /></AppLayout>} />
            <Route path="/patients/:id" element={<AppLayout><PatientDetailPage /></AppLayout>} />
            <Route path="/professionals" element={<AppLayout><ProfessionalsPage /></AppLayout>} />
            <Route path="/schedule" element={<AppLayout><SchedulePage /></AppLayout>} />
            <Route path="/reception" element={<AppLayout><ReceptionPage /></AppLayout>} />
            <Route path="/records" element={<AppLayout><MedicalRecordsPage /></AppLayout>} />
            <Route path="/financial" element={<AppLayout><FinancialPage /></AppLayout>} />
            <Route path="/settings" element={<AppLayout><SettingsPage /></AppLayout>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
