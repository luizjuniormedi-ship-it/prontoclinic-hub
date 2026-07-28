import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/StateViews";
import {
  module19NursingService,
  type Module19Classification,
  type Module19CompleteResult,
  type Module19TriageRecord,
} from "@/services/module19NursingService";
import { ReclassificationPanel } from "./ReclassificationPanel";
import { TriageAtomicForm } from "./TriageAtomicForm";

interface Module19TriageWorkspaceProps {
  unitId: number;
  initialPatientId?: number | null;
  initialAppointmentId?: number | null;
  initialQueueId?: number | null;
}

export function Module19TriageWorkspace({
  unitId,
  initialPatientId,
  initialAppointmentId,
  initialQueueId,
}: Module19TriageWorkspaceProps) {
  const [classifications, setClassifications] = useState<Module19Classification[]>([]);
  const [triages, setTriages] = useState<Module19TriageRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => triages.find((triage) => triage.id === selectedId) ?? null,
    [selectedId, triages],
  );
  const classificationById = useMemo(
    () => new Map(classifications.map((classification) => [classification.id, classification])),
    [classifications],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalog, recent] = await Promise.all([
        module19NursingService.listClassifications(),
        module19NursingService.listRecent(unitId),
      ]);
      setClassifications(catalog);
      setTriages(recent);
      setSelectedId((current) => current ?? recent[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o módulo.");
    } finally {
      setLoading(false);
    }
  }, [unitId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCompleted = (result: Module19CompleteResult) => {
    setTriages((current) => [
      result.triage,
      ...current.filter((item) => item.id !== result.triage.id),
    ]);
    setSelectedId(result.triage.id);
  };

  const handleReclassified = (triage: Module19TriageRecord) => {
    setTriages((current) => current.map((item) => (item.id === triage.id ? triage : item)));
  };

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Carregando triagens
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }

  return (
    <div className="space-y-4">
      <div
        className="flex items-center gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
        role="status"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Administração de medicamentos exige prescrição M20 ativa e assinada.
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
        <TriageAtomicForm
          unitId={unitId}
          classifications={classifications}
          initialPatientId={initialPatientId}
          initialAppointmentId={initialAppointmentId}
          initialQueueId={initialQueueId}
          onCompleted={handleCompleted}
        />
        <ReclassificationPanel
          triage={selected}
          classifications={classifications}
          onReclassified={handleReclassified}
        />
      </div>

      <Card className="rounded-lg">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" />
            Triagens recentes
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          {triages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma triagem registrada nesta unidade.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Data</th>
                    <th className="px-2 py-2 font-medium">Paciente</th>
                    <th className="px-2 py-2 font-medium">Agendamento</th>
                    <th className="px-2 py-2 font-medium">Classificação</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 text-right font-medium">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {triages.map((triage) => {
                    const classification = triage.cd_classificacao_id
                      ? classificationById.get(triage.cd_classificacao_id)
                      : undefined;
                    return (
                      <tr
                        className={selectedId === triage.id ? "bg-muted/60" : "border-b last:border-0"}
                        key={triage.id}
                      >
                        <td className="px-2 py-2">
                          {new Date(triage.dt_triagem).toLocaleString("pt-BR")}
                        </td>
                        <td className="px-2 py-2">#{triage.cd_paciente}</td>
                        <td className="px-2 py-2">
                          {triage.cd_appointment ? `#${triage.cd_appointment}` : "Espontâneo"}
                        </td>
                        <td className="px-2 py-2">
                          {classification ? (
                            <span className="inline-flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="h-2.5 w-2.5 rounded-full border"
                                style={{ backgroundColor: classification.cd_cor_hex }}
                              />
                              {classification.ds_classificacao}
                            </span>
                          ) : (
                            "Não informada"
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <Badge variant="outline">{triage.tp_status}</Badge>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button
                            size="sm"
                            variant={selectedId === triage.id ? "secondary" : "ghost"}
                            onClick={() => setSelectedId(triage.id)}
                          >
                            Selecionar
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

