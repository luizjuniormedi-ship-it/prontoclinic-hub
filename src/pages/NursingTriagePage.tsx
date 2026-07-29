/**
 * NursingTriagePage — Página principal do módulo de Triagem
 *
 * Renderiza o TriagePanel dentro do layout autenticado padrão.
 * Quando ?tv=1 na URL, renderiza o QueueDisplay em modo TV.
 */

import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { TriagePanel } from "@/components/nursing/TriagePanel";
import { QueueDisplay } from "@/components/nursing/QueueDisplay";

export default function NursingTriagePage(): JSX.Element {
  const [params] = useSearchParams();
  const { activeCompanyId: companyId, activeUnitId: unitId } = useAuth();

  // Modo TV para sala de espera
  if (params.get("tv") === "1" || params.get("mode") === "tv") {
    if (!companyId || !unitId) {
      return (
        <div className="p-8 text-center text-muted-foreground">
          Carregando contexto da empresa...
        </div>
      );
    }
    return <QueueDisplay companyId={companyId} unitId={unitId} modoTV />;
  }

  if (!companyId || !unitId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Carregando contexto da empresa...
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6">
      <TriagePanel companyId={companyId} unitId={unitId} />
    </div>
  );
}
