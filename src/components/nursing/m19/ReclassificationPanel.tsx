import { useEffect, useState } from "react";
import { History, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  module19NursingService,
  type Module19Classification,
  type Module19ReclassificationRecord,
  type Module19TriageRecord,
} from "@/services/module19NursingService";

interface ReclassificationPanelProps {
  triage: Module19TriageRecord | null;
  classifications: Module19Classification[];
  onReclassified(triage: Module19TriageRecord): void;
}

export function ReclassificationPanel({
  triage,
  classifications,
  onReclassified,
}: ReclassificationPanelProps) {
  const [classificationId, setClassificationId] = useState("");
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<Module19ReclassificationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setClassificationId("");
    setReason("");
    setHistory([]);
    setError(null);
    if (!triage) return () => { active = false; };

    setLoading(true);
    void module19NursingService
      .listReclassificationHistory(triage.id)
      .then((rows) => {
        if (active) setHistory(rows);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Não foi possível carregar o histórico.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [triage]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!triage || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await module19NursingService.reclassify({
        triageId: triage.id,
        classificationId: Number(classificationId),
        reason,
      });
      setHistory((current) => [result.reclassification, ...current]);
      setClassificationId("");
      setReason("");
      onReclassified(result.triage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível reclassificar.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="rounded-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          Reclassificação
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!triage ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Selecione uma triagem registrada.
          </p>
        ) : (
          <>
            <form className="space-y-3" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label>Nova classificação</Label>
                <Select value={classificationId} onValueChange={setClassificationId}>
                  <SelectTrigger aria-label="Nova classificação de risco">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {classifications
                      .filter((item) => item.id !== triage.cd_classificacao_id)
                      .map((classification) => (
                        <SelectItem key={classification.id} value={String(classification.id)}>
                          {classification.ds_classificacao}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m19-reclassification-reason">Motivo clínico</Label>
                <Textarea
                  id="m19-reclassification-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  minLength={3}
                  rows={3}
                  required
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button
                className="w-full"
                type="submit"
                variant="outline"
                disabled={submitting || !classificationId}
              >
                {submitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Registrar reclassificação
              </Button>
            </form>

            <div className="border-t pt-3">
              <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                Histórico imutável
              </p>
              {loading ? (
                <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando
                </div>
              ) : history.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">Sem registros.</p>
              ) : (
                <ol className="space-y-2">
                  {history.map((entry) => (
                    <li className="border-l-2 pl-3 text-sm" key={entry.id}>
                      <p className="font-medium">{entry.tipo.replace(/_/g, " ")}</p>
                      <p className="text-muted-foreground">{entry.motivo}</p>
                      <time className="text-xs text-muted-foreground">
                        {new Date(entry.created_at).toLocaleString("pt-BR")}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
