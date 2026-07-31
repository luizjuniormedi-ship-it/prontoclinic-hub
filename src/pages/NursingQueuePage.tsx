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
      <div className="p-8 text-center" role="alert">
        <h1 className="text-lg font-semibold">Selecione uma unidade operacional</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          O painel de Enfermagem precisa de uma unidade ativa. Use o seletor de empresa, unidade e perfil no cabeçalho.
        </p>
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
