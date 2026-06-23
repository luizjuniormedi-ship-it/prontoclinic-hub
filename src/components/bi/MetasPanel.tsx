/**
 * MetasPanel.tsx
 *
 * CRUD de metas de KPI por clínica e período.
 *
 * - Lista metas ativas com barra de progresso
 * - Formulário para criar/editar (KPI, valor, período, comparação, datas)
 * - Botões "Editar" e "Excluir" inline
 *
 * Usa TanStack Query para cache isolado por (companyId) + mutations para
 * criar/atualizar/excluir metas. Invalida cache automaticamente após mutação.
 *
 * Dependências: useState/useEffect, lucide-react, ui/*, useToast, biService
 *               @tanstack/react-query
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Target, Pencil, Trash2, Plus, X, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  biService,
  type Meta, type PeriodoTipo, type ComparacaoTipo, type KpiCodigo,
} from "@/services/biService";

interface MetasPanelProps {
  companyId: string;
}

const KPIS: Array<{ value: KpiCodigo; label: string; unit: string }> = [
  { value: "TAXA_NO_SHOW", label: "Taxa de No-Show", unit: "%" },
  { value: "TAXA_CONFIRMACAO", label: "Taxa de Confirmação", unit: "%" },
  { value: "OCUPACAO", label: "Ocupação da Agenda", unit: "%" },
  { value: "FATURAMENTO_MENSAL", label: "Faturamento Mensal", unit: "R$" },
  { value: "TICKET_MEDIO", label: "Ticket Médio", unit: "R$" },
  { value: "TEMPO_ESPERA", label: "Tempo Médio de Espera", unit: "min" },
  { value: "GLOSA_PERCENT", label: "Percentual de Glosa", unit: "%" },
];

const PERIODOS: Array<{ value: PeriodoTipo; label: string }> = [
  { value: "DIARIO", label: "Diário" },
  { value: "SEMANAL", label: "Semanal" },
  { value: "MENSAL", label: "Mensal" },
  { value: "ANUAL", label: "Anual" },
];

const COMPARACOES: Array<{ value: ComparacaoTipo; label: string }> = [
  { value: "IGUAL_MAIOR", label: "Igual ou maior que" },
  { value: "IGUAL_MENOR", label: "Igual ou menor que" },
  { value: "ENTRE", label: "Entre faixa" },
];

interface FormState {
  cd_kpi: KpiCodigo;
  vl_meta: string;
  tp_periodo: PeriodoTipo;
  dt_inicio: string;
  dt_fim: string;
  tp_comparacao: ComparacaoTipo;
  ds_observacao: string;
}

const initialForm: FormState = {
  cd_kpi: "TAXA_NO_SHOW",
  vl_meta: "",
  tp_periodo: "MENSAL",
  dt_inicio: new Date().toISOString().split("T")[0],
  dt_fim: "",
  tp_comparacao: "IGUAL_MENOR",
  ds_observacao: "",
};

export function MetasPanel({ companyId }: MetasPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<Meta | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [dialogAberto, setDialogAberto] = useState(false);

  const { data: metas = [], isLoading } = useQuery({
    queryKey: ["bi", "metas", companyId],
    queryFn: () => biService.getMetas(companyId),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (editando) {
      setForm({
        cd_kpi: editando.cd_kpi as KpiCodigo,
        vl_meta: String(editando.vl_meta),
        tp_periodo: editando.tp_periodo,
        dt_inicio: editando.dt_inicio,
        dt_fim: editando.dt_fim ?? "",
        tp_comparacao: editando.tp_comparacao ?? "IGUAL_MAIOR",
        ds_observacao: editando.ds_observacao ?? "",
      });
    } else {
      setForm(initialForm);
    }
  }, [editando]);

  const salvarMut = useMutation({
    mutationFn: async (input: { meta: Partial<Meta>; editId: number | null }) => {
      if (input.editId) {
        return biService.updateMeta(input.editId, input.meta);
      }
      return biService.createMeta(companyId, { ...input.meta, cd_usuario_criou: user?.id ?? null });
    },
    onSuccess: (data) => {
      toast({ title: editando ? "Meta atualizada." : "Meta criada." });
      setDialogAberto(false);
      setEditando(null);
      void queryClient.invalidateQueries({ queryKey: ["bi", "metas", companyId] });
      void data;
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Erro ao salvar meta.";
      toast({ variant: "destructive", title: msg });
    },
  });

  const excluirMut = useMutation({
    mutationFn: (id: number) => biService.deleteMeta(id),
    onSuccess: () => {
      toast({ title: "Meta excluída." });
      void queryClient.invalidateQueries({ queryKey: ["bi", "metas", companyId] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Erro ao excluir.";
      toast({ variant: "destructive", title: msg });
    },
  });

  const abrirNova = () => {
    setEditando(null);
    setForm(initialForm);
    setDialogAberto(true);
  };

  const abrirEdicao = (m: Meta) => {
    setEditando(m);
    setDialogAberto(true);
  };

  const salvar = async () => {
    const vl = Number(form.vl_meta);
    if (!Number.isFinite(vl) || vl <= 0) {
      toast({ variant: "destructive", title: "Valor da meta inválido." });
      return;
    }
    salvarMut.mutate({
      editId: editando?.id ?? null,
      meta: {
        cd_kpi: form.cd_kpi,
        vl_meta: vl,
        tp_periodo: form.tp_periodo,
        dt_inicio: form.dt_inicio,
        dt_fim: form.dt_fim || null,
        tp_comparacao: form.tp_comparacao,
        ds_observacao: form.ds_observacao || null,
      },
    });
  };

  const excluir = (m: Meta) => {
    if (!window.confirm(`Excluir meta "${m.cd_kpi}"?`)) return;
    excluirMut.mutate(m.id);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="h-5 w-5" />
          Metas de Performance
        </CardTitle>
        <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={abrirNova}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Nova meta
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editando ? "Editar meta" : "Nova meta"}</DialogTitle>
              <DialogDescription>
                Defina um objetivo para acompanhar a performance da clínica.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="kpi">KPI</Label>
                <Select
                  value={form.cd_kpi}
                  onValueChange={(v) => setForm((f) => ({ ...f, cd_kpi: v as KpiCodigo }))}
                >
                  <SelectTrigger id="kpi">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KPIS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="valor">Valor da meta</Label>
                  <Input
                    id="valor"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.vl_meta}
                    onChange={(e) => setForm((f) => ({ ...f, vl_meta: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="periodo">Período</Label>
                  <Select
                    value={form.tp_periodo}
                    onValueChange={(v) => setForm((f) => ({ ...f, tp_periodo: v as PeriodoTipo }))}
                  >
                    <SelectTrigger id="periodo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERIODOS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="comparacao">Tipo de comparação</Label>
                <Select
                  value={form.tp_comparacao}
                  onValueChange={(v) => setForm((f) => ({ ...f, tp_comparacao: v as ComparacaoTipo }))}
                >
                  <SelectTrigger id="comparacao">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPARACOES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="inicio">Início</Label>
                  <Input
                    id="inicio"
                    type="date"
                    value={form.dt_inicio}
                    onChange={(e) => setForm((f) => ({ ...f, dt_inicio: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fim">Fim (opcional)</Label>
                  <Input
                    id="fim"
                    type="date"
                    value={form.dt_fim}
                    onChange={(e) => setForm((f) => ({ ...f, dt_fim: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="obs">Observação</Label>
                <Textarea
                  id="obs"
                  value={form.ds_observacao}
                  onChange={(e) => setForm((f) => ({ ...f, ds_observacao: e.target.value }))}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogAberto(false)} disabled={salvarMut.isPending}>
                <X className="mr-1.5 h-3.5 w-3.5" />
                Cancelar
              </Button>
              <Button onClick={salvar} disabled={salvarMut.isPending}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {salvarMut.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Carregando metas...</p>
        ) : metas.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Nenhuma meta cadastrada. Clique em "Nova meta" para começar.
          </p>
        ) : (
          <ul className="space-y-3">
            {metas.map((m) => {
              const kpi = KPIS.find((k) => k.value === m.cd_kpi);
              const progresso = calcularProgresso(m, kpi?.unit);
              return (
                <li key={m.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{kpi?.label ?? m.cd_kpi}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {m.tp_periodo}
                        </Badge>
                        {(() => {
                          const isActive = !m.dt_fim || new Date(m.dt_fim) >= new Date();
                          return isActive ? (
                            <Badge variant="secondary" className="text-[10px]">
                              Ativa
                            </Badge>
                          ) : null;
                        })()}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatarComparacao(m)} {kpi?.unit ?? ""} {m.vl_meta}
                        {m.dt_fim && ` · até ${m.dt_fim}`}
                      </p>
                      {m.ds_observacao && (
                        <p className="text-xs text-muted-foreground italic mt-1">
                          {m.ds_observacao}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => abrirEdicao(m)}
                        aria-label="Editar meta"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={() => excluir(m)}
                        aria-label="Excluir meta"
                        disabled={excluirMut.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Progresso atual</span>
                      <span className="font-medium">{progresso.percent.toFixed(0)}%</span>
                    </div>
                    <Progress value={progresso.percent} className="h-1.5" />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Atual: <strong>{m.vl_atual}</strong> de {m.vl_meta}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatarComparacao(m: Meta): string {
  switch (m.tp_comparacao) {
    case "IGUAL_MAIOR": return "≥";
    case "IGUAL_MENOR": return "≤";
    case "ENTRE": return "entre";
    default: return "≥";
  }
}

function calcularProgresso(m: Meta, _unit?: string): { percent: number } {
  if (!m.vl_meta || m.vl_meta === 0) return { percent: 0 };
  const ratio = (m.vl_atual / m.vl_meta) * 100;
  // Para "menor que", inverte o progresso (atingir meta = valor baixo)
  if (m.tp_comparacao === "IGUAL_MENOR") {
    if (m.vl_atual === 0) return { percent: 100 };
    return { percent: Math.min(100, Math.max(0, 100 - ratio)) };
  }
  return { percent: Math.min(100, Math.max(0, ratio)) };
}