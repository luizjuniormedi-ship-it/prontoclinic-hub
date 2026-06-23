/**
 * LabPage — Página principal do módulo LIS/Laboratório
 */

import { PageHeader } from "@/components/PageHeader";
import { LabOrdersManager } from "@/components/lis/LabOrdersManager";

export default function LabPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Laboratório (LIS)"
        description="Catálogo de exames, pedidos, resultados HL7 v2.5 e alertas críticos"
      />
      <LabOrdersManager />
    </div>
  );
}
