/**
 * NursingTriagePage — Página principal do módulo de Triagem
 *
 * Renderiza o TriagePanel dentro do layout autenticado padrão.
 * Quando ?tv=1 na URL, renderiza o QueueDisplay em modo TV.
 */

import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { TriagePanel } from "@/components/nursing/TriagePanel";
import { QueueDisplay } from "@/components/nursing/QueueDisplay";

export default function NursingTriagePage(): JSX.Element {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const companyId = user?.company_id;

  // Modo TV para sala de espera
  if (params.get("tv") === "1" || params.get("mode") === "tv") {
    if (!companyId) {
      return (
        <div className="p-8 text-center text-muted-foreground">
          Carregando contexto da empresa...
        </div>
      );
    }
    return <QueueDisplay companyId={companyId} modoTV />;
  }

  if (!companyId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Carregando contexto da empresa...
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4">
      <PageHeader
        title="Triagem de Enfermagem"
        description="Classificação Manchester + NEWS2 — sinais vitais, antropometria e fila específica"
      />
      <TriagePanel companyId={companyId} />
    </div>
  );
}
