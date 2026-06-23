/**
 * AlertasPanel.tsx
 *
 * Painel de alertas de performance do BI.
 *
 * - Lista alertas pendentes (e permite ver resolvidos)
 * - Filtro por severidade (INFO / ATENCAO / CRITICO)
 * - Filtro por status (pendente / resolvido)
 * - Botão "Resolver" inline
 * - Mostra sugestão de ação quando disponível
 *
 * Usa TanStack Query para cache isolado por (companyId) — compartilha cache
 * com o dashboard principal e com a página dedicada de alertas.
 *
 * Dependências: useState/useMemo, lucide-react, ui/*, StateViews, biService
 *               @tanstack/react-query
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, Info, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { LoadingState } from "@/components/StateViews";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/utils/friendlyError";
import { biService, type Alerta, type Severidade } from "@/services/biService";

interface AlertasPanelProps {
  companyId: string;
  limite?: number;
  onRecarregar?: () => void;
}

const severidadeIcon: Record<Severidade, React.ComponentType<{ className?: string }>> = {
  INFO: Info,
  ATENCAO: AlertTriangle,
  CRITICO: AlertCircle,
};

const severidadeVariant: Record<Severidade, string> = {
  INFO: "bg-primary/10 text-primary border-primary/20",
  ATENCAO: "bg-warning/10 text-warning border-warning/20",
  CRITICO: "bg-destructive/10 text-destructive border-destructive/20",
};

type StatusFilter = "pendente" | "resolvido" | "todos";

export function AlertasPanel({ companyId, limite = 50, onRecarregar }: AlertasPanelProps) {
  const [severidade, setSeveridade] = useState<Severidade | "TODOS">("TODOS");
  const [status, setStatus] = useState<StatusFilter>("pendente");
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Pendentes (com filtro opcional de severidade)
  const { data: pendentes = [], isLoading: loadingPendentes } = useQuery({
    queryKey: ["bi", "alertas", companyId, "pendentes"],
    queryFn: () => biService.getAlertasPendentes(companyId, { limite }),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  // Histórico (inclui resolvidos) — só carrega se o usuário filtrar por resolvido/todos
  const { data: historico = [], isLoading: loadingHistorico } = useQuery({
    queryKey: ["bi", "alertas", companyId, "historico", limite],
    queryFn: () => biService.getAlertasHistorico(companyId, limite),
    enabled: !!companyId && status !== "pendente",
    staleTime: 30_000,
  });

  const alertas: Alerta[] = status === "pendente" ? pendentes : historico;
  const loading = status === "pendente" ? loadingPendentes : loadingHistorico;

  const resolverMut = useMutation({
    mutationFn: (alertaId: number) => {
      if (!user?.id) throw new Error("Usuário não autenticado.");
      return biService.resolverAlerta(alertaId, user.id);
    },
    onSuccess: () => {
      toast({ title: "Alerta resolvido." });
      void queryClient.invalidateQueries({ queryKey: ["bi", "alertas", companyId] });
    },
    onError: (err) => {
      toast({ variant: "destructive", title: friendlyError(err, "Resolver") });
    },
  });

  const filtrados = useMemo(() => {
    return alertas.filter((a) => {
      if (status === "pendente" && a.lg_resolvido) return false;
      if (status === "resolvido" && !a.lg_resolvido) return false;
      if (severidade !== "TODOS" && a.tp_severidade !== severidade) return false;
      return true;
    });
  }, [alertas, severidade, status]);

  const contadores = useMemo(() => {
    return {
      CRITICO: pendentes.filter((a) => a.tp_severidade === "CRITICO").length,
      ATENCAO: pendentes.filter((a) => a.tp_severidade === "ATENCAO").length,
      INFO: pendentes.filter((a) => a.tp_severidade === "INFO").length,
    };
  }, [pendentes]);

  const handleResolver = (alertaId: number) => {
    resolverMut.mutate(alertaId);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bell className="h-5 w-5" />
          Alertas de Performance
        </CardTitle>
        {onRecarregar && (
          <Button variant="ghost" size="sm" onClick={onRecarregar}>
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Atualizar
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Resumo rápido */}
        <div className="grid grid-cols-3 gap-2">
          <ResumoCard label="Críticos" value={contadores.CRITICO} severity="CRITICO" />
          <ResumoCard label="Atenção" value={contadores.ATENCAO} severity="ATENCAO" />
          <ResumoCard label="Info" value={contadores.INFO} severity="INFO" />
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          <Select value={severidade} onValueChange={(v) => setSeveridade(v as Severidade | "TODOS")}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Severidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS">Todas</SelectItem>
              <SelectItem value="CRITICO">Crítico</SelectItem>
              <SelectItem value="ATENCAO">Atenção</SelectItem>
              <SelectItem value="INFO">Info</SelectItem>
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pendente">Pendentes</SelectItem>
              <SelectItem value="resolvido">Resolvidos</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Lista */}
        {loading ? (
          <LoadingState message="Carregando alertas..." />
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-success mb-2" />
            Nenhum alerta {status === "pendente" ? "pendente" : "encontrado"} neste filtro.
          </div>
        ) : (
          <ul className="space-y-2">
            {filtrados.map((a) => {
              const Icon = severidadeIcon[a.tp_severidade];
              return (
                <li
                  key={a.id}
                  className={`rounded-md border p-3 ${severidadeVariant[a.tp_severidade]} ${
                    a.lg_resolvido ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {a.cd_kpi}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {a.tp_severidade}
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatarDataRelativa(a.dt_alerta)}
                        </span>
                      </div>
                      <p className="text-sm font-medium mt-1">{a.ds_alerta}</p>
                      <div className="text-xs mt-1 grid grid-cols-2 gap-x-3">
                        <span>Atual: <strong>{a.vl_atual}</strong></span>
                        <span>Esperado: <strong>{a.vl_esperado}</strong></span>
                      </div>
                      {a.ds_sugestao && (
                        <p className="text-xs mt-2 italic text-muted-foreground">
                          Sugestão: {a.ds_sugestao}
                        </p>
                      )}
                    </div>
                    {!a.lg_resolvido && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => handleResolver(a.id)}
                        disabled={resolverMut.isPending}
                      >
                        Resolver
                      </Button>
                    )}
                    {a.lg_resolvido && (
                      <Badge variant="secondary" className="text-[10px]">
                        Resolvido
                      </Badge>
                    )}
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

function ResumoCard({
  label,
  value,
  severity,
}: { label: string; value: number; severity: Severidade }) {
  const Icon = severidadeIcon[severity];
  return (
    <div className={`rounded-md border p-2 ${severidadeVariant[severity]}`}>
      <div className="flex items-center justify-between">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xl font-bold">{value}</span>
      </div>
      <p className="text-[10px] uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

function formatarDataRelativa(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}
