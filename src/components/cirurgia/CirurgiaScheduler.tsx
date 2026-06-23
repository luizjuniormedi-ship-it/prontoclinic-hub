/**
 * CirurgiaScheduler — Calendário cirúrgico + agendamento.
 *
 * Mostra agenda diária, status das salas e materiais consumidos.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Plus, Scissors, Clock, Save, X, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { useToast } from "@/hooks/use-toast";
import {
  cirurgiaService,
  type Cirurgia,
  type SalaCirurgica,
} from "@/services/cirurgiaService";

type StatusCirurgia = Cirurgia["tp_status"];
type TipoCirurgia = Cirurgia["tp_cirurgia"];

const STATUS_COR: Record<StatusCirurgia, string> = {
  AGENDADA: "bg-blue-100 text-blue-800 border-blue-300",
  PRE_OPERATORIO: "bg-yellow-100 text-yellow-800 border-yellow-300",
  EM_ANDAMENTO: "bg-orange-100 text-orange-800 border-orange-300",
  CONCLUIDA: "bg-green-100 text-green-800 border-green-300",
  CANCELADA: "bg-red-100 text-red-800 border-red-300",
  SUSPENSA: "bg-gray-100 text-gray-800 border-gray-300",
};

const STATUS_LABEL: Record<StatusCirurgia, string> = {
  AGENDADA: "Agendada",
  PRE_OPERATORIO: "Pré-op",
  EM_ANDAMENTO: "Em andamento",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
  SUSPENSA: "Suspensa",
};

function formatarDataISO(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export function CirurgiaScheduler() {
  const { toast } = useToast();
  const [salas, setSalas] = useState<SalaCirurgica[]>([]);
  const [cirurgias, setCirurgias] = useState<Cirurgia[]>([]);
  const [dataSelecionada, setDataSelecionada] = useState<string>(formatarDataISO(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // form
  const [cdPaciente, setCdPaciente] = useState("");
  const [cdSala, setCdSala] = useState("");
  const [dtAgendamento, setDtAgendamento] = useState("");
  const [tpCirurgia, setTpCirurgia] = useState<TipoCirurgia>("ELETIVA");
  const [dsTecnica, setDsTecnica] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [salasData, cirurgiasData] = await Promise.all([
        cirurgiaService.salas.getAll(true),
        cirurgiaService.cirurgias.getAll({
          dataInicio: `${dataSelecionada}T00:00:00`,
          dataFim: `${dataSelecionada}T23:59:59`,
        }),
      ]);
      setSalas(salasData);
      setCirurgias(cirurgiasData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, [dataSelecionada]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const handleAgendar = useCallback(async () => {
    if (!cdPaciente || !dtAgendamento) {
      toast({ title: "Preencha paciente e data", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await cirurgiaService.cirurgias.create({
        cd_paciente: Number(cdPaciente),
        cd_sala: cdSala ? Number(cdSala) : null,
        dt_agendamento: dtAgendamento,
        tp_cirurgia: tpCirurgia,
        ds_tecnica: dsTecnica || null,
        tp_status: "AGENDADA",
      });
      toast({ title: "Cirurgia agendada" });
      setShowForm(false);
      setCdPaciente("");
      setCdSala("");
      setDtAgendamento("");
      setDsTecnica("");
      void carregar();
    } catch (err) {
      toast({
        title: "Erro ao agendar",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [cdPaciente, cdSala, dtAgendamento, tpCirurgia, dsTecnica, toast, carregar]);

  const stats = useMemo(() => {
    return {
      total: cirurgias.length,
      agendadas: cirurgias.filter((c) => c.tp_status === "AGENDADA").length,
      emAndamento: cirurgias.filter((c) => c.tp_status === "EM_ANDAMENTO").length,
      concluidas: cirurgias.filter((c) => c.tp_status === "CONCLUIDA").length,
    };
  }, [cirurgias]);

  if (loading) return <LoadingState message="Carregando agenda cirúrgica..." />;
  if (error) return <ErrorState message={error} onRetry={carregar} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Centro Cirúrgico"
        description="Agenda de cirurgias por sala e dia"
        actions={
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4 mr-1" />
            Agendar cirurgia
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total no dia</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Agendadas</p>
            <p className="text-2xl font-bold text-blue-600">{stats.agendadas}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Em andamento</p>
            <p className="text-2xl font-bold text-orange-600">{stats.emAndamento}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Concluídas</p>
            <p className="text-2xl font-bold text-green-600">{stats.concluidas}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            type="date"
            value={dataSelecionada}
            onChange={(e) => setDataSelecionada(e.target.value)}
            className="max-w-xs"
          />
        </CardContent>
      </Card>

      {showForm && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Nova cirurgia</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cd_paciente">ID do Paciente</Label>
                <Input
                  id="cd_paciente"
                  type="number"
                  value={cdPaciente}
                  onChange={(e) => setCdPaciente(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cd_sala">Sala</Label>
                <select
                  id="cd_sala"
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                  value={cdSala}
                  onChange={(e) => setCdSala(e.target.value)}
                >
                  <option value="">— Selecione —</option>
                  {salas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.ds_nome} {s.tp_sala ? `(${s.tp_sala})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="dt_agendamento">Data/hora</Label>
                <Input
                  id="dt_agendamento"
                  type="datetime-local"
                  value={dtAgendamento}
                  onChange={(e) => setDtAgendamento(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="tp_cirurgia">Tipo</Label>
                <select
                  id="tp_cirurgia"
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                  value={tpCirurgia}
                  onChange={(e) => setTpCirurgia(e.target.value as TipoCirurgia)}
                >
                  <option value="ELETIVA">Eletiva</option>
                  <option value="URGENCIA">Urgência</option>
                  <option value="EMERGENCIA">Emergência</option>
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="tecnica">Técnica / descrição</Label>
              <Textarea
                id="tecnica"
                rows={3}
                value={dsTecnica}
                onChange={(e) => setDsTecnica(e.target.value)}
              />
            </div>
            <Button onClick={() => void handleAgendar()} disabled={saving}>
              <Save className="h-4 w-4 mr-1" />
              Agendar
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {salas.map((sala) => {
          const cirs = cirurgias.filter((c) => c.cd_sala === sala.id);
          return (
            <Card key={sala.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Scissors className="h-4 w-4" />
                    {sala.ds_nome}
                  </span>
                  <Badge variant="outline">{cirs.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {cirs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma cirurgia nesta sala no dia selecionado.</p>
                ) : (
                  cirs.map((c) => (
                    <div
                      key={c.id}
                      className={`p-3 rounded-md border ${STATUS_COR[c.tp_status]}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">Paciente #{c.cd_paciente}</p>
                          <p className="text-xs flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(c.dt_agendamento).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            · {c.tp_cirurgia}
                          </p>
                        </div>
                        <Badge className={STATUS_COR[c.tp_status]}>
                          {STATUS_LABEL[c.tp_status]}
                        </Badge>
                      </div>
                      {c.ds_tecnica && (
                        <p className="text-xs mt-1 flex items-center gap-1">
                          <FileText className="h-3 w-3" /> {c.ds_tecnica}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {salas.length === 0 && (
        <EmptyState
          icon={Scissors}
          title="Nenhuma sala cadastrada"
          description="Cadastre salas cirúrgicas em Cadastros para usar este módulo."
        />
      )}
    </div>
  );
}
