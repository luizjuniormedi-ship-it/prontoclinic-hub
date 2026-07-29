/**
 * NursingQueuePage - Painel operacional da fila de Enfermagem.
 *
 * Mantem a chamada de pacientes separada da tela de registro de triagem.
 */

import { useSearchParams } from "react-router-dom";
import { QueueDisplay } from "@/components/nursing/QueueDisplay";
import { useAuth } from "@/hooks/useAuth";

export default function NursingQueuePage(): JSX.Element {
  const [params] = useSearchParams();
  const { activeCompanyId: companyId, activeUnitId: unitId } = useAuth();

  if (!companyId || !unitId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Carregando contexto da empresa...
      </div>
    );
  }

  const modoTV = params.get("tv") === "1" || params.get("mode") === "tv";

  if (modoTV) {
    return <QueueDisplay companyId={companyId} unitId={unitId} modoTV />;
  }

  return (
    <div className="container mx-auto p-4 md:p-6">
      <QueueDisplay companyId={companyId} unitId={unitId} modoTV={false} />
    </div>
  );
}
