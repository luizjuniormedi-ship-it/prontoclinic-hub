import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { LiveRegion } from "@/components/a11y/LiveRegion";
import { useLiveAnnounce } from "@/components/a11y/LiveRegion";
import { useLocation } from "react-router-dom";

export function AppLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const { message, announce } = useLiveAnnounce();

  // Mount global keyboard shortcuts (Ctrl+K, Ctrl+N, g+d, g+a, ...)
  useKeyboardShortcuts();

  // Announce page changes to screen readers (polite, non-urgent)
  const pathLabels: Record<string, string> = {
    "/": "Dashboard",
    "/patients": "Pacientes",
    "/professionals": "Profissionais",
    "/schedule": "Agenda",
    "/callcenter": "Call Center",
    "/reception": "Recepção",
    "/records": "Prontuário",
    "/worklist": "Worklist",
    "/pacs": "PACS",
    "/dicom/orders": "Pedidos de Imagem",
    "/dicom/worklist": "DICOM Worklist",
    "/dicom/reports": "Laudos",
    "/dicom/modalities": "Equipamentos",
    "/dicom/nodes": "Nós DICOM",
    "/dicom/dashboard": "Integração DICOM",
    "/financial": "Financeiro",
    "/billing-production": "Faturamento",
    "/professional-payment": "Pagamento de Profissionais",
    "/companies": "Empresas",
    "/master-data": "Cadastros",
    "/admin/users": "Usuários",
    "/admin/profiles": "Perfis",
    "/admin/permissions": "Permissões",
    "/settings": "Configurações",
  };
  const currentPage = pathLabels[location.pathname] || "Página";

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        role="status"
        aria-live="polite"
        aria-label="Carregando aplicação"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <AppHeader />
          <main
            id="main-content"
            role="main"
            tabIndex={-1}
            aria-label={`Conteúdo principal: ${currentPage}`}
            className="flex-1 p-6 overflow-auto focus:outline-none"
            onFocus={() => announce(`Navegou para ${currentPage}`)}
          >
            {children}
          </main>
        </div>
      </div>
      <LiveRegion message={message} politeness="polite" />
    </SidebarProvider>
  );
}
