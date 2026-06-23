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
import NpsSurveyPage from "@/pages/NpsSurveyPage";
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
const PharmacyManager = lazy(() =>
  import("@/components/pharmacy/PharmacyManager").then((m) => ({ default: m.PharmacyManager })),
);

const MeusAgendamentosPage = lazy(() => import("@/pages/MeusAgendamentosPage"));
const ShortcutsHelp = lazy(() => import("@/pages/ShortcutsHelp").then((m) => ({ default: m.ShortcutsHelp })));
const PharmacyPage = lazy(() => import("@/pages/PharmacyPage"));
const NursingTriagePage = lazy(() => import("@/pages/NursingTriagePage"));
const BiDashboardPage = lazy(() => import("@/pages/BiDashboardPage"));
const BiMetasPage = lazy(() => import("@/pages/BiMetasPage"));
const BiAlertasPage = lazy(() => import("@/pages/BiAlertasPage"));
const LabPage = lazy(() => import("@/pages/LabPage"));

// Telemedicina
const TelemedicinePage = lazy(() => import("@/pages/TelemedicinePage"));

// Agente 38: IA + Internação + Centro Cirúrgico + PA + Assinatura Digital
const InternacaoPage = lazy(() => import("@/pages/InternacaoPage"));
const CirurgiaPage = lazy(() => import("@/pages/CirurgiaPage"));
const PaPage = lazy(() => import("@/pages/PaPage"));
const AssinaturaDigitalPage = lazy(() => import("@/pages/AssinaturaDigitalPage"));
const IaClinicaPage = lazy(() => import("@/pages/IaClinicaPage"));

// Agente 37: Compras + Transporte + NPS
const PurchasesPage = lazy(() => import("@/pages/PurchasesPage"));
const TransportPage = lazy(() => import("@/pages/TransportPage"));
const NpsDashboardPage = lazy(() => import("@/pages/NpsDashboardPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dados clínicos mudam com frequência moderada — 30s é o sweet spot.
      // Sem isso, o default (0ms) faz refetch a cada navegação/foco.
      staleTime: 30_000,
      // Mantém em cache por 5min para evitar refetch em navegação rápida
      gcTime: 5 * 60_000,
      // Desabilita refetch em window focus — economiza requests
      // (cada aba aberta = 1 refetch desnecessário por foco)
      refetchOnWindowFocus: false,
      // Retry 1x em caso de erro (default é 3 — muito agressivo para clínica)
      retry: 1,
    },
    mutations: {
      // Sem retry em mutações — pode causar duplicação de receita/dispensação
      retry: 0,
    },
  },
});

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

            {/* LIS / Laboratório */}
            <Route path="/lab" element={<AppLayout><ProtectedRoute path="/lab"><LazyRoute><LabPage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Patient portal */}
            <Route path="/meus-agendamentos" element={<AppLayout><ProtectedRoute path="/meus-agendamentos"><LazyRoute><MeusAgendamentosPage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Telemedicina */}
            <Route path="/telemedicina" element={<AppLayout><ProtectedRoute path="/telemedicina"><LazyRoute><TelemedicinePage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Pharmacy */}
            <Route path="/pharmacy" element={<AppLayout><ProtectedRoute path="/pharmacy"><LazyRoute><PharmacyPage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Nursing / Triage */}
            <Route path="/nursing/triage" element={<AppLayout><ProtectedRoute path="/nursing"><LazyRoute><NursingTriagePage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/nursing/queue" element={<AppLayout><ProtectedRoute path="/nursing"><LazyRoute><NursingTriagePage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* BI / Indicadores */}
            <Route path="/bi" element={<AppLayout><ProtectedRoute path="/bi"><LazyRoute><BiDashboardPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/bi/metas" element={<AppLayout><ProtectedRoute path="/bi"><LazyRoute><BiMetasPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/bi/alertas" element={<AppLayout><ProtectedRoute path="/bi"><LazyRoute><BiAlertasPage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Agente 38: Módulos clínicos avançados */}
            <Route path="/internacao" element={<AppLayout><ProtectedRoute path="/internacao"><LazyRoute><InternacaoPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/cirurgia" element={<AppLayout><ProtectedRoute path="/cirurgia"><LazyRoute><CirurgiaPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/pa" element={<AppLayout><ProtectedRoute path="/pa"><LazyRoute><PaPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/assinatura" element={<AppLayout><ProtectedRoute path="/assinatura"><LazyRoute><AssinaturaDigitalPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/ia-clinica" element={<AppLayout><ProtectedRoute path="/ia-clinica"><LazyRoute><IaClinicaPage /></LazyRoute></ProtectedRoute></AppLayout>} />

            {/* Agente 37: Compras + Transporte + NPS */}
            <Route path="/purchases" element={<AppLayout><ProtectedRoute path="/purchases"><LazyRoute><PurchasesPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/transport" element={<AppLayout><ProtectedRoute path="/transport"><LazyRoute><TransportPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            <Route path="/nps" element={<AppLayout><ProtectedRoute path="/nps"><LazyRoute><NpsDashboardPage /></LazyRoute></ProtectedRoute></AppLayout>} />
            {/* NPS público — sem auth, sem layout */}
            <Route path="/nps/:token" element={<NpsSurveyPage />} />

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
