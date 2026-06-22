/**
 * SolicitacoesTab — workflow PENDENTE → EM_ANDAMENTO → CONCLUIDA | REJEITADA
 * LGPD art. 18 — prazo legal de 15 dias para resposta
 * Migration: 20260101000006_lgpd.sql
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, XCircle, Clock, History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  lgpdService,
  type LgpdSolicitacao,
  type StatusSolicitacao,
} from "@/services/lgpdService";

export function SolicitacoesTab() {
  const [statusFilter, setStatusFilter] = useState<StatusSolicitacao | "TODOS">("PENDENTE");
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const queryClient = useQueryClient();

  const { data: solicitacoes, isLoading } = useQuery({
    queryKey: ["lgpd-solicitacoes", statusFilter],
    queryFn: () =>
      lgpdService.getSolicitacoes(statusFilter === "TODOS" ? undefined : statusFilter),
  });

  const processar = useMutation({
    mutationFn: ({
      id,
      acao,
      payload,
    }: {
      id: number;
      acao: "concluir" | "rejeitar";
      payload?: { motivoRejeicao?: string; exportacao?: Record<string, unknown> };
    }) => lgpdService.processarSolicitacao(id, acao, payload),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["lgpd-solicitacoes"] });
      toast.success(
        vars.acao === "concluir" ? "Solicitacao concluida" : "Solicitacao rejeitada",
      );
      setRejectingId(null);
      setRejectReason("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const statusBadge = (s: StatusSolicitacao) => {
    const map: Record<StatusSolicitacao, { color: string; icon: JSX.Element; label: string }> = {
      PENDENTE: { color: "bg-yellow-100 text-yellow-800", icon: <Clock className="h-3 w-3" />, label: "Pendente" },
      EM_ANDAMENTO: { color: "bg-blue-100 text-blue-800", icon: <Loader2 className="h-3 w-3 animate-spin" />, label: "Em Andamento" },
      CONCLUIDA: { color: "bg-green-100 text-green-800", icon: <CheckCircle2 className="h-3 w-3" />, label: "Concluida" },
      REJEITADA: { color: "bg-red-100 text-red-800", icon: <XCircle className="h-3 w-3" />, label: "Rejeitada" },
    };
    const cfg = map[s];
    return (
      <Badge className={`${cfg.color} gap-1`}>
        {cfg.icon}
        {cfg.label}
      </Badge>
    );
  };

  const diasParaPrazo = (dt_prazo: string) => {
    const dias = Math.floor((new Date(dt_prazo).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (dias < 0) return <span className="text-red-600 font-bold">Vencida ha {Math.abs(dias)}d</span>;
    if (dias <= 3) return <span className="text-orange-600 font-bold">{dias}d restantes</span>;
    return <span className="text-muted-foreground">{dias}d restantes</span>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Solicitacoes do Titular
        </CardTitle>
        <CardDescription>
          LGPD art. 18 — prazo legal de 15 dias para resposta (art. 18 §5).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 items-center">
          <Label>Filtrar por status:</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusSolicitacao | "TODOS")}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS">Todos</SelectItem>
              <SelectItem value="PENDENTE">Pendente</SelectItem>
              <SelectItem value="EM_ANDAMENTO">Em Andamento</SelectItem>
              <SelectItem value="CONCLUIDA">Concluida</SelectItem>
              <SelectItem value="REJEITADA">Rejeitada</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Carregando...</div>
        ) : (solicitacoes || []).length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nenhuma solicitacao {statusFilter !== "TODOS" ? statusFilter.toLowerCase() : ""}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Paciente</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead>Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(solicitacoes || []).map((s: LgpdSolicitacao) => (
                <TableRow key={s.id}>
                  <TableCell>#{s.id}</TableCell>
                  <TableCell>#{s.cd_paciente}</TableCell>
                  <TableCell><Badge variant="outline">{s.tipo}</Badge></TableCell>
                  <TableCell>{statusBadge(s.status)}</TableCell>
                  <TableCell>{diasParaPrazo(s.dt_prazo)}</TableCell>
                  <TableCell>
                    {s.status === "PENDENTE" || s.status === "EM_ANDAMENTO" ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => processar.mutate({ id: s.id, acao: "concluir" })}
                          disabled={processar.isPending}
                        >
                          Concluir
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRejectingId(s.id)}
                          disabled={processar.isPending}
                        >
                          Rejeitar
                        </Button>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Modal de rejeicao */}
        <Dialog open={!!rejectingId} onOpenChange={(o) => !o && setRejectingId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rejeitar Solicitacao</DialogTitle>
              <DialogDescription>
                Informe o motivo da rejeicao (minimo 10 caracteres).
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Ex: Documentacao insuficiente, paciente nao localizado..."
              rows={4}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRejectingId(null)}>Cancelar</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (rejectingId) {
                    processar.mutate({
                      id: rejectingId,
                      acao: "rejeitar",
                      payload: { motivoRejeicao: rejectReason },
                    });
                  }
                }}
                disabled={rejectReason.length < 10 || processar.isPending}
              >
                Confirmar Rejeicao
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export default SolicitacoesTab;
