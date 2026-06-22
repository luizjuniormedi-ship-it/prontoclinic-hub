/**
 * AuditLogViewer.tsx
 *
 * Visualizador de logs de auditoria para admin e DPO.
 *
 * Features:
 *   * Filtros: tabela, ação, usuário, período
 *   * Tabela paginada com Data/Hora, Usuário, Role, Ação, Tabela, Registro, IP
 *   * Modal de detalhes com diff JSON (dados_anteriores vs dados_novos)
 *   * Exportação JSON via auditService.exportarEbaixar
 *
 * Substitui qualquer UI anterior que usava mockAuditLogs do mockData.ts.
 * Conformidade: LGPD Art. 37 (registro) + Art. 50 (transparência).
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Download,
  Filter,
  Loader2,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { AuditLog, AuditFilters } from "@/types";
import { auditService } from "@/services/auditService";
import { AuditLogRow, formatDateTime } from "./AuditLogRow";

// Cores/helpers foram movidos para AuditLogRow.tsx (linha memoizada)

export function AuditLogViewer() {
  const [tabela, setTabela] = useState<string>("");
  const [acao, setAcao] = useState<string>("");
  const [cdUsuario, setCdUsuario] = useState<string>("");
  const [dataInicio, setDataInicio] = useState<string>("");
  const [dataFim, setDataFim] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const pageSize = 50;

  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);

  const filters: AuditFilters = useMemo(
    () => ({
      tabela: tabela || undefined,
      acao: acao || undefined,
      cd_usuario: cdUsuario || undefined,
      data_inicio: dataInicio || undefined,
      data_fim: dataFim || undefined,
      page,
      pageSize,
    }),
    [tabela, acao, cdUsuario, dataInicio, dataFim, page],
  );

  const { data: logs, isLoading, error, refetch } = useQuery({
    queryKey: ["audit-logs", filters],
    queryFn: () => auditService.getAll(filters),
    staleTime: 30_000,
  });

  // Resetar página ao mudar filtros
  useEffect(() => {
    setPage(1);
  }, [tabela, acao, cdUsuario, dataInicio, dataFim]);

  const tabelasDisponiveis = auditService.getTabelasAuditaveis();
  const acoesDisponiveis = auditService.getAcoesAuditaveis();

  function limparFiltros() {
    setTabela("");
    setAcao("");
    setCdUsuario("");
    setDataInicio("");
    setDataFim("");
    setPage(1);
  }

  async function handleExportar() {
    setExporting(true);
    try {
      await auditService.exportarEbaixar(filters);
    } catch (e) {
      console.error("Erro ao exportar auditoria:", e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4 p-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Trilha de Auditoria
              </CardTitle>
              <CardDescription>
                Registro imutável de operações em dados sensíveis (LGPD Art. 37).
                Apenas admin e DPO podem visualizar.
              </CardDescription>
            </div>
            <Button
              onClick={handleExportar}
              disabled={exporting}
              variant="outline"
            >
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Exportar (JSON)
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* ── Filtros ── */}
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-5">
            <div>
              <Label htmlFor="filter-tabela">Tabela</Label>
              <Select value={tabela} onValueChange={setTabela}>
                <SelectTrigger id="filter-tabela">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas</SelectItem>
                  {tabelasDisponiveis.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="filter-acao">Ação</Label>
              <Select value={acao} onValueChange={setAcao}>
                <SelectTrigger id="filter-acao">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas</SelectItem>
                  {acoesDisponiveis.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="filter-usuario">Usuário (UUID)</Label>
              <Input
                id="filter-usuario"
                value={cdUsuario}
                onChange={(e) => setCdUsuario(e.target.value)}
                placeholder="uuid do usuário"
              />
            </div>

            <div>
              <Label htmlFor="filter-inicio">De</Label>
              <Input
                id="filter-inicio"
                type="datetime-local"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="filter-fim">Até</Label>
              <Input
                id="filter-fim"
                type="datetime-local"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
              />
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Filter className="h-4 w-4" />
              {logs?.length ?? 0} evento(s) nesta página
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={limparFiltros}>
                Limpar filtros
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Atualizar
              </Button>
            </div>
          </div>

          {/* ── Tabela ── */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4" />
              Erro ao carregar logs: {(error as Error).message}
            </div>
          ) : !logs || logs.length === 0 ? (
            <div className="rounded border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              Nenhum evento encontrado com os filtros atuais.
            </div>
          ) : (
            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Tabela</TableHead>
                    <TableHead>Registro</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead className="text-right">Detalhes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <AuditLogRow
                      key={`${log.id}-${log.createdAt}`}
                      log={log}
                      onView={(l) => setSelectedLog(l as AuditLog | null)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* ── Paginação ── */}
          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground">
              Página {page}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!logs || logs.length < pageSize}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Modal de detalhes com diff JSON ── */}
      <Dialog
        open={!!selectedLog}
        onOpenChange={(open) => !open && setSelectedLog(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Detalhes do evento — {selectedLog?.action} em{" "}
              {selectedLog?.entity}
            </DialogTitle>
            <DialogDescription>
              {selectedLog && formatDateTime(selectedLog.createdAt)} •{" "}
              {selectedLog?.userName}
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Operação:</span>{" "}
                  {(selectedLog.details?.operacao as string) ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Role:</span>{" "}
                  {(selectedLog.details?.role_name as string) ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">IP origem:</span>{" "}
                  {(selectedLog.details?.ip_origem as string) ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Request ID:</span>{" "}
                  {(selectedLog.details?.request_id as string) ?? "—"}
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">User-Agent:</span>{" "}
                  <span className="break-all text-xs">
                    {(selectedLog.details?.user_agent as string) ?? "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    Retenção até:
                  </span>{" "}
                  {(selectedLog.details?.dt_retencao as string) ?? "—"}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <h4 className="mb-1 text-sm font-semibold">
                    Dados anteriores
                  </h4>
                  <pre className="max-h-72 overflow-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(
                      selectedLog.details?.dados_anteriores ?? null,
                      null,
                      2,
                    )}
                  </pre>
                </div>
                <div>
                  <h4 className="mb-1 text-sm font-semibold">Dados novos</h4>
                  <pre className="max-h-72 overflow-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(
                      selectedLog.details?.dados_novos ?? null,
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AuditLogViewer;