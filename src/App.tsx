import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import LoginPage from "@/pages/LoginPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import DashboardPage from "@/pages/DashboardPage";
import PatientsPage from "@/pages/PatientsPage";
import PatientDetailPage from "@/pages/PatientDetailPage";
import PatientCreatePage from "@/pages/PatientCreatePage";
import PatientEditPage from "@/pages/PatientEditPage";
import ProfessionalsPage from "@/pages/ProfessionalsPage";
import SchedulePage from "@/pages/SchedulePage";
import ReceptionPage from "@/pages/ReceptionPage";
import MedicalRecordsPage from "@/pages/MedicalRecordsPage";
import AttendancePage from "@/pages/AttendancePage";
import FinancialPage from "@/pages/FinancialPage";
import SettingsPage from "@/pages/SettingsPage";
import AdminUsersPage from "@/pages/AdminUsersPage";
import AdminProfilesPage from "@/pages/AdminProfilesPage";
import AdminPermissionsPage from "@/pages/AdminPermissionsPage";
import CompaniesPage from "@/pages/CompaniesPage";
import CallCenterPage from "@/pages/CallCenterPage";
import WorklistPage from "@/pages/WorklistPage";
import PACSPage from "@/pages/PACSPage";
import BillingProductionPage from "@/pages/BillingProductionPage";
import ProfessionalPaymentPage from "@/pages/ProfessionalPaymentPage";
import MasterDataPage from "@/pages/MasterDataPage";
import DicomNodesPage from "@/pages/DicomNodesPage";
import DicomModalitiesPage from "@/pages/DicomModalitiesPage";
import ImagingOrdersPage from "@/pages/ImagingOrdersPage";
import DicomWorklistPage from "@/pages/DicomWorklistPage";
import DicomDashboardPage from "@/pages/DicomDashboardPage";
import RadiologyReportsPage from "@/pages/RadiologyReportsPage";
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
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/" element={<AppLayout><ProtectedRoute path="/"><DashboardPage /></ProtectedRoute></AppLayout>} />
            <Route path="/patients" element={<AppLayout><ProtectedRoute path="/patients"><PatientsPage /></ProtectedRoute></AppLayout>} />
            <Route path="/patients/new" element={<AppLayout><ProtectedRoute path="/patients"><PatientCreatePage /></ProtectedRoute></AppLayout>} />
            <Route path="/patients/:id" element={<AppLayout><ProtectedRoute path="/patients"><PatientDetailPage /></ProtectedRoute></AppLayout>} />
            <Route path="/patients/:id/edit" element={<AppLayout><ProtectedRoute path="/patients"><PatientEditPage /></ProtectedRoute></AppLayout>} />
            <Route path="/professionals" element={<AppLayout><ProtectedRoute path="/professionals"><ProfessionalsPage /></ProtectedRoute></AppLayout>} />
            <Route path="/schedule" element={<AppLayout><ProtectedRoute path="/schedule"><SchedulePage /></ProtectedRoute></AppLayout>} />
            <Route path="/callcenter" element={<AppLayout><ProtectedRoute path="/callcenter"><CallCenterPage /></ProtectedRoute></AppLayout>} />
            <Route path="/reception" element={<AppLayout><ProtectedRoute path="/reception"><ReceptionPage /></ProtectedRoute></AppLayout>} />
            <Route path="/records" element={<AppLayout><ProtectedRoute path="/records"><MedicalRecordsPage /></ProtectedRoute></AppLayout>} />
            <Route path="/attendance/:appointmentId" element={<AppLayout><ProtectedRoute path="/attendance"><AttendancePage /></ProtectedRoute></AppLayout>} />
            <Route path="/worklist" element={<AppLayout><ProtectedRoute path="/worklist"><WorklistPage /></ProtectedRoute></AppLayout>} />
            <Route path="/pacs" element={<AppLayout><ProtectedRoute path="/pacs"><PACSPage /></ProtectedRoute></AppLayout>} />
            <Route path="/dicom/nodes" element={<AppLayout><ProtectedRoute path="/dicom"><DicomNodesPage /></ProtectedRoute></AppLayout>} />
            <Route path="/dicom/modalities" element={<AppLayout><ProtectedRoute path="/dicom"><DicomModalitiesPage /></ProtectedRoute></AppLayout>} />
            <Route path="/dicom/orders" element={<AppLayout><ProtectedRoute path="/dicom"><ImagingOrdersPage /></ProtectedRoute></AppLayout>} />
            <Route path="/dicom/worklist" element={<AppLayout><ProtectedRoute path="/dicom"><DicomWorklistPage /></ProtectedRoute></AppLayout>} />
            <Route path="/dicom/dashboard" element={<AppLayout><ProtectedRoute path="/dicom"><DicomDashboardPage /></ProtectedRoute></AppLayout>} />
            <Route path="/dicom/reports" element={<AppLayout><ProtectedRoute path="/dicom/reports"><RadiologyReportsPage /></ProtectedRoute></AppLayout>} />
            <Route path="/financial" element={<AppLayout><ProtectedRoute path="/financial"><FinancialPage /></ProtectedRoute></AppLayout>} />
            <Route path="/billing-production" element={<AppLayout><ProtectedRoute path="/billing-production"><BillingProductionPage /></ProtectedRoute></AppLayout>} />
            <Route path="/professional-payment" element={<AppLayout><ProtectedRoute path="/professional-payment"><ProfessionalPaymentPage /></ProtectedRoute></AppLayout>} />
            <Route path="/settings" element={<AppLayout><ProtectedRoute path="/settings"><SettingsPage /></ProtectedRoute></AppLayout>} />
            <Route path="/master-data" element={<AppLayout><ProtectedRoute path="/master-data"><MasterDataPage /></ProtectedRoute></AppLayout>} />
            <Route path="/companies" element={<AppLayout><ProtectedRoute path="/companies"><CompaniesPage /></ProtectedRoute></AppLayout>} />
            <Route path="/admin/users" element={<AppLayout><ProtectedRoute path="/admin"><AdminUsersPage /></ProtectedRoute></AppLayout>} />
            <Route path="/admin/profiles" element={<AppLayout><ProtectedRoute path="/admin"><AdminProfilesPage /></ProtectedRoute></AppLayout>} />
            <Route path="/admin/permissions" element={<AppLayout><ProtectedRoute path="/admin"><AdminPermissionsPage /></ProtectedRoute></AppLayout>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
