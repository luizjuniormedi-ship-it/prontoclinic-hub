import { PageHeader } from "@/components/PageHeader";
import { CareProtocolWorkspace } from "@/components/protocols/m21/CareProtocolWorkspace";
import { clinicalPermissionsFor } from "@/config/clinicalModulePermissions";
import { useAuth } from "@/hooks/useAuth";

export default function CareProtocolsPage() {
  const { user } = useAuth();
  const permissions = clinicalPermissionsFor(user?.role_name).m21;

  return (
    <section className="space-y-6 p-6" aria-labelledby="care-protocols-title">
      <PageHeader
        titleId="care-protocols-title"
        title="Protocolos assistenciais"
        description="Definições versionadas, execução clínica, tarefas, alertas, escalonamentos e overrides auditáveis."
      />
      <CareProtocolWorkspace canManageDefinitions={permissions.canManageDefinitions} />
    </section>
  );
}
