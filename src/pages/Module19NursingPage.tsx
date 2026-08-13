import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState } from "@/components/StateViews";
import { Module19TriageWorkspace } from "@/components/nursing/m19";
import { useAuth } from "@/hooks/useAuth";

function positiveQueryNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function Module19NursingPage() {
  const { user, activeUnitId } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const unitId = Number.isInteger(activeUnitId) && Number(activeUnitId) > 0
    ? Number(activeUnitId)
    : null;

  const context = useMemo(
    () => ({
      patientId: positiveQueryNumber(searchParams.get("patientId")),
      appointmentId: positiveQueryNumber(searchParams.get("appointmentId")),
      queueId: positiveQueryNumber(searchParams.get("queueId")),
    }),
    [searchParams],
  );

  if (!user) {
    return <ErrorState message="Sessão autenticada obrigatória." />;
  }
  if (!unitId) {
    return <ErrorState message="Selecione uma unidade autorizada para acessar a triagem." />;
  }

  return (
    <div className="container mx-auto space-y-4 p-4 md:p-6">
      <PageHeader
        title="Enfermagem e triagem"
        description="Avaliação clínica, classificação de risco e histórico de reclassificação"
      />
      <Module19TriageWorkspace
        unitId={unitId}
        initialPatientId={context.patientId}
        initialAppointmentId={context.appointmentId}
        initialQueueId={context.queueId}
        onAttendanceReady={(appointmentId) => navigate(`/attendance/${appointmentId}`)}
      />
    </div>
  );
}
