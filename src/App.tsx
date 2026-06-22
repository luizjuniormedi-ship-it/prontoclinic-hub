import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";

// Public pages — eager import for fast FCP/TTI on login + pre-cadastro
import LoginPage from "@/pages/LoginPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import PreCadastroPage from "@/pages/PreCadastroPage";
import ConfirmarEmailPage from "@/pages/ConfirmarEmailPage";
import NotFound from "@/pages/NotFound";

// Authenticated pages — lazy loaded (code-split per route)
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));

// Patients
const PatientsPage = lazy(() => import("@/pages/PatientsPage"));
const PatientDetailPage = lazy(() => import("@/pages/PatientDetailPage"));
const PatientCreatePage = lazy(() => import("@/pages/PatientCreatePage"));
const PatientEditPage = lazy(() => import("@/pages/PatientEditPage"));

// Clinical
const ProfessionalsPage = lazy(() => import("@/pages/ProfessionalsPage"));
const SchedulePage = lazy(() => import("@/pages/SchedulePage"));
const ReceptionPage = lazy(() => import("@/pages/ReceptionPage"));
const MedicalRecordsPage = lazy(() => import("@/pages/MedicalRecordsPage"));
const AttendancePage = lazy(() => import("@/pages/AttendancePage"));
const CallCenterPage = lazy(() => import("@/pages/CallCenterPage"));

// Imaging / PACS / DICOM
const WorklistPage = lazy(() => import("@/pages/WorklistPage"));
const PACSPage = lazy(() => import("@/pages/PACSPage"));
const BillingProductionPage = lazy(() => import("@/pages/BillingProductionPage"));
const ProfessionalPaymentPage = lazy(() => import("@/pages/ProfessionalPaymentPage"));
const MasterDataPage = lazy(() => import("@/pages/MasterDataPage"));
const DicomNodesPage = lazy(() => import("@/pages/DicomNodesPage"));
const DicomModalitiesPage = lazy(() => import("@/pages/DicomModalitiesPage"));
const ImagingOrdersPage = lazy(() => import("@/pages/ImagingOrdersPage"));
const DicomWorklistPage = lazy(() => import("@/pages/DicomWorklistPage"));
const DicomDashboardPage = lazy(() => import("@/pages/DicomDashboardPage"));
const RadiologyReportsPage = lazy(() => import("@/pages/RadiologyReportsPage"));

// Financial
const FinancialPage = lazy(() => import("@/pages/FinancialPage"));

// Settings + Admin
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const AdminUsersPage = lazy(() => import("@/pages/AdminUsersPage"));
const AdminProfilesPage = lazy(() => import("@/pages/AdminProfilesPage"));
const AdminPermissionsPage = lazy(() => import("@/pages/AdminPermissionsPage"));
const CompaniesPage = lazy(() => import("@/pages/CompaniesPage"));

// Feature components (admin)
const InsuranceManager = lazy(() =>
  import("@/components/insurance/InsuranceManager").then((m) => ({ default: m.InsuranceManager })),
);
const PriceTableEditor = lazy(() =>
  import("@/components/price-table/PriceTableEditor").then((m) => ({ default: m.PriceTableEditor })),
);
const LGPDManager = lazy(() =>
  import("@/components/lgpd/LGPDManager").then((m) => ({ default: m.LGPDManager })),
);
const AuditLogViewer = lazy(() =>
  import("@/components/audit/AuditLogViewer").then((m) => ({ default: m.AuditLogViewer })),
);
const TissManager = lazy(() =>
  import("@/components/billing/TissManager").then((m) => ({ default: m.TissManager })),
);
const DicomEquipmentManager = lazy(() =>
  import("@/components/dicom/DicomEquipmentManager").then((m) => ({ default: m.DicomEquipmentManager })),
);
const ReportTemplateEditor = lazy(() =>
  import("@/components/dicom/ReportTemplateEditor").then((m) => ({ default: m.ReportTemplateEditor })),
);
const DicomViewer = lazy(() =>
  import("@/components/dicom/DicomViewer").then((m) => ({ default: m.DicomViewer })),
);
const NotificationCenter = lazy(() =>
  import("@/components/notifications/NotificationCenter").then((m) => ({ default: m.NotificationCenter })),
);

const MeusAgendamentosPage = lazy(() => import("@/pages/MeusAgendamentosPage"));
const ShortcutsHelp = lazy(() => import("@/pages/ShortcutsHelp"));

const queryClient = new QueryClient();

/** Suspense fallback used while a lazy chunk is being fetched. */
function LoadingFallback() {
  return (
    <div
      className="flex items-center justify-center min-h-[50vh]"
      role="status"
      aria-live="polite"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

/** Wraps children in Suspense so each lazy route can stream in independently. */
function LazyRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingFallback />}>{children}</Suspense>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <PWAUpdatePrompt />
      <ShortcutsHelp />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public — eager */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/pre-cadastro" element={<PreCadastroPage />} />
            <Route path="/pre-cadastro/confirmar" element={<ConfirmarEmailPage />} />
            <Route path="/confirmar-email" element={<ConfirmarEmailPage />} />

            {/* Authenticated — lazy */}
            <Route path="/" element={<AppLayout><ProtectedRoute path="/"><LazyRoute><DashboardPage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Patients */}
            <Route path="/patients" element={<AppLayout><ProtectedRoute path="/patients"><LazyRoute><PatientsPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/patients/new" element={<AppLayout><ProtectedRoute path="/patients"><LazyRoute><PatientCreatePage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/patients/:id" element={<AppLayout><ProtectedRoute path="/patients"><LazyRoute><PatientDetailPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/patients/:id/edit" element={<AppLayout><ProtectedRoute path="/patients"><LazyRoute><PatientEditPage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Clinical */}
            <Route path="/professionals" element={<AppLayout><ProtectedRoute path="/professionals"><LazyRoute><ProfessionalsPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/schedule" element={<AppLayout><ProtectedRoute path="/schedule"><LazyRoute><SchedulePage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/callcenter" element={<AppLayout><ProtectedRoute path="/callcenter"><LazyRoute><CallCenterPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/reception" element={<AppLayout><ProtectedRoute path="/reception"><LazyRoute><ReceptionPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/records" element={<AppLayout><ProtectedRoute path="/records"><LazyRoute><MedicalRecordsPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/attendance/:appointmentId" element={<AppLayout><ProtectedRoute path="/attendance"><LazyRoute><AttendancePage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Imaging / PACS / DICOM */}
            <Route path="/worklist" element={<AppLayout><ProtectedRoute path="/worklist"><LazyRoute><WorklistPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/pacs" element={<AppLayout><ProtectedRoute path="/pacs"><LazyRoute><PACSPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/dicom/nodes" element={<AppLayout><ProtectedRoute path="/dicom"><LazyRoute><DicomNodesPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/dicom/modalities" element={<AppLayout><ProtectedRoute path="/dicom"><LazyRoute><DicomModalitiesPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/dicom/orders" element={<AppLayout><ProtectedRoute path="/dicom"><LazyRoute><ImagingOrdersPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/dicom/worklist" element={<AppLayout><ProtectedRoute path="/dicom"><LazyRoute><DicomWorklistPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/dicom/dashboard" element={<AppLayout><ProtectedRoute path="/dicom"><LazyRoute><DicomDashboardPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/dicom/reports" element={<AppLayout><ProtectedRoute path="/dicom/reports"><LazyRoute><RadiologyReportsPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/admin/dicom" element={<AppLayout><ProtectedRoute path="/admin"><LazyRoute><DicomEquipmentManager /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/admin/report-templates" element={<AppLayout><ProtectedRoute path="/admin"><LazyRoute><ReportTemplateEditor /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Financial */}
            <Route path="/financial" element={<AppLayout><ProtectedRoute path="/financial"><LazyRoute><FinancialPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/billing-production" element={<AppLayout><ProtectedRoute path="/billing-production"><LazyRoute><BillingProductionPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/professional-payment" element={<AppLayout><ProtectedRoute path="/professional-payment"><LazyRoute><ProfessionalPaymentPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/admin/tiss" element={<AppLayout><ProtectedRoute path="/admin"><LazyRoute><TissManager /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Master + Companies */}
            <Route path="/settings" element={<AppLayout><ProtectedRoute path="/settings"><LazyRoute><SettingsPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/master-data" element={<AppLayout><ProtectedRoute path="/master-data"><LazyRoute><MasterDataPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/companies" element={<AppLayout><ProtectedRoute path="/companies"><LazyRoute><CompaniesPage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Admin (users/profiles/permissions) */}
            <Route path="/admin/users" element={<AppLayout><ProtectedRoute path="/admin"><LazyRoute><AdminUsersPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/admin/profiles" element={<AppLayout><ProtectedRoute path="/admin"><LazyRoute><AdminProfilesPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/admin/permissions" element={<AppLayout><ProtectedRoute path="/admin"><LazyRoute><AdminPermissionsPage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Admin (insurances / price tables / LGPD / audit / notifications) */}
            <Route path="/admin/insurances" element={<AppLayout><ProtectedRoute path="/admin"><LazyRoute><InsuranceManager /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/admin/price-tables" element={<AppLayout><ProtectedRoute path="/admin"><LazyRoute><PriceTableEditor /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/admin/credentialing" element={<AppLayout><ProtectedRoute path="/admin"><LazyRoute><ProfessionalCredentialingPlaceholder /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/admin/lgpd" element={<AppLayout><ProtectedRoute path="/admin"><LazyRoute><LGPDManager /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/admin/audit" element={<AppLayout><ProtectedRoute path="/admin"><LazyRoute><AuditLogViewer /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/admin/notifications" element={<AppLayout><ProtectedRoute path="/admin"><LazyRoute><NotificationCenter /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Patient portal */}
            <Route path="/meus-agendamentos" element={<AppLayout><ProtectedRoute path="/meus-agendamentos"><LazyRoute><MeusAgendamentosPage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

/**
 * Placeholder usado apenas para a rota de credenciamento.
 * Mantém a rota viva até a Agente 1 entregar o componente ProfessionalCredentialing.
 */
function ProfessionalCredentialingPlaceholder() {
  return (
    <div className="p-8 text-center text-muted-foreground">
      <h2 className="text-lg font-semibold text-foreground">Credenciamento de Profissionais</h2>
      <p className="mt-2 text-sm">Em breve — componente em desenvolvimento.</p>
    </div>
  );
}

export default App;
