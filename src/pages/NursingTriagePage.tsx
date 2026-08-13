/**
 * NursingTriagePage — Página principal do módulo de Triagem
 *
 * Renderiza o TriagePanel dentro do layout autenticado padrão.
 * Quando ?tv=1 na URL, renderiza o QueueDisplay em modo TV.
 */

import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { QueueDisplay } from "@/components/nursing/QueueDisplay";

export default function NursingTriagePage(): JSX.Element {
  const [params] = useSearchParams();
  const { activeCompanyId: companyId, activeUnitId: unitId } = useAuth();

  // Modo TV para sala de espera
  if (params.get("tv") === "1" || params.get("mode") === "tv") {
    if (!companyId || !unitId) {
      return (
        <div className="p-8 text-center" role="alert">
          <h1 className="text-lg font-semibold">Selecione uma unidade operacional</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A Triagem precisa de uma unidade ativa. Use o seletor de empresa, unidade e perfil no cabeçalho.
          </p>
        </div>
      );
    }
    return <QueueDisplay companyId={companyId} unitId={unitId} modoTV />;
  }

  if (!companyId || !unitId) {
    return (
      <div className="p-8 text-center" role="alert">
        <h1 className="text-lg font-semibold">Selecione uma unidade operacional</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A Triagem precisa de uma unidade ativa. Use o seletor de empresa, unidade e perfil no cabeçalho.
        </p>
      </div>
    );
  }

  return <Navigate replace to={`/nursing/clinical${params.toString() ? `?${params.toString()}` : ""}`} />;
}
