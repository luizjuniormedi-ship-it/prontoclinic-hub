/**
 * LabPage — Página principal do módulo LIS/Laboratório
 */

import { PageHeader } from "@/components/PageHeader";
import { LabOrdersManager } from "@/components/lis/LabOrdersManager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LisConfigurationPanel } from "@/features/lis/components/LisConfigurationPanel";
import { LisOperationsPanel } from "@/features/lis/components/LisOperationsPanel";
import { useAuth } from "@/hooks/useAuth";
import { AlertTriangle, ClipboardList, FlaskConical, Settings2 } from "lucide-react";

function isValidUnitId(unitId: number | null): unitId is number {
  return Number.isSafeInteger(unitId) && unitId > 0;
}

export default function LabPage() {
  const { companyId, activeUnitId, user } = useAuth();
  const roleName = user?.role_name ?? undefined;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Laboratório (LIS)"
        description="Catálogo de exames, pedidos, resultados HL7 v2.5 e alertas críticos"
      />

      {!companyId?.trim() || !isValidUnitId(activeUnitId) ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Contexto de acesso indisponível</AlertTitle>
          <AlertDescription>
            Selecione uma empresa e uma unidade válidas para acessar o laboratório.
          </AlertDescription>
        </Alert>
      ) : (
        <Tabs defaultValue="orders" className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-1 sm:grid-cols-3">
            <TabsTrigger value="orders" className="gap-2">
              <ClipboardList className="h-4 w-4" />
              Pedidos
            </TabsTrigger>
            <TabsTrigger value="operations" className="gap-2">
              <FlaskConical className="h-4 w-4" />
              Operações
            </TabsTrigger>
            <TabsTrigger value="configuration" className="gap-2">
              <Settings2 className="h-4 w-4" />
              Configuração
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            <LabOrdersManager />
          </TabsContent>
          <TabsContent value="operations">
            <LisOperationsPanel
              companyId={companyId}
              unitId={activeUnitId}
              roleName={roleName}
            />
          </TabsContent>
          <TabsContent value="configuration">
            <LisConfigurationPanel
              companyId={companyId}
              unitId={activeUnitId}
              roleName={roleName}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
