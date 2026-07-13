/**
 * TissLoteList — Tabela de lotes TISS com filtros
 * Sub-componente extraido de TissManager.tsx
 */

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Send,
  Eye,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  XCircle,
  RefreshCw,
} from "lucide-react";
import {
  tissService,
  type TissStatus,
  type TissXml,
} from "@/services/tissService";
import { insuranceCompanyService } from "@/services/insuranceService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function statusBadge(s: TissStatus): { label: string; cls: string; icon: typeof FileText } {
  const map: Record<TissStatus, { label: string; cls: string; icon: typeof FileText }> = {
    PENDENTE: { label: "Pendente", cls: "bg-yellow-100 text-yellow-800", icon: FileText },
    ENVIADO: { label: "Enviado", cls: "bg-blue-100 text-blue-800", icon: Send },
    PROCESSADO: { label: "Processado", cls: "bg-indigo-100 text-indigo-800", icon: CheckCircle2 },
    GLOSADO: { label: "Glosado", cls: "bg-orange-100 text-orange-800", icon: AlertTriangle },
    RECEBIDO: { label: "Recebido", cls: "bg-emerald-100 text-emerald-800", icon: CheckCircle2 },
    PAGO: { label: "Pago", cls: "bg-green-100 text-green-800", icon: DollarSign },
    CANCELADO: { label: "Cancelado", cls: "bg-gray-100 text-gray-800", icon: XCircle },
    REJEITADO: { label: "Rejeitado", cls: "bg-red-100 text-red-800", icon: XCircle },
  };
  return map[s] || map.PENDENTE;
}

export interface TissLoteListProps {
  companyId: string;
  mes: number;
  ano: number;
  filterStatus: TissStatus | "ALL";
  setFilterStatus: (s: TissStatus | "ALL") => void;
  filterConvenio: number | "ALL";
  setFilterConvenio: (v: number | "ALL") => void;
  onSelectXml: (xml: TissXml) => void;
}

interface TissRowProps {
  fatura: TissXml;
  onSelectXml: (xml: TissXml) => void;
}

const TissRow = memo(function TissRow({ fatura, onSelectXml }: TissRowProps) {
  const sb = statusBadge(fatura.status);
  const Icon = sb.icon;
  const convenioNome =
    (fatura as TissXml & { insurance_companies?: { name: string } }).insurance_companies?.name ||
    fatura.cd_convenio ||
    "—";
  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => onSelectXml(fatura)}
    >
      <TableCell><code className="text-xs">{fatura.cd_lote || "—"}</code></TableCell>
      <TableCell>
        <Badge variant="outline">{fatura.ds_tipo_guia || "—"}</Badge>
      </TableCell>
      <TableCell className="text-xs">{convenioNome}</TableCell>
      <TableCell>
        {fatura.ds_protocolo ? (
          <code className="text-xs">{fatura.ds_protocolo}</code>
        ) : "—"}
      </TableCell>
      <TableCell>
        {(fatura.vl_informado || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </TableCell>
      <TableCell>
        {(fatura.vl_liberado || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </TableCell>
      <TableCell>
        {(fatura.vl_glosa || 0) > 0 ? (
          <span className="text-orange-600 font-medium">
            {(fatura.vl_glosa || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </span>
        ) : "—"}
      </TableCell>
      <TableCell>
        <Badge className={sb.cls}>
          <Icon className="h-3 w-3 mr-1" />
          {sb.label}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm" variant="outline"
            onClick={() => onSelectXml(fatura)}
            title="Ver detalhes"
          >
            <Eye className="h-3 w-3" />
          </Button>
          {fatura.status === "PENDENTE" && (
            <Button
              size="sm" variant="default"
              disabled
              title="Transmissao indisponivel ate configuracao do backend seguro"
            >
              <Send className="h-3 w-3" />
            </Button>
          )}
          {fatura.status === "GLOSADO" && (
            <Button
              size="sm" variant="outline"
              disabled
              title="Recurso de glosa indisponivel ate existir backend TISS seguro"
            >
              <AlertTriangle className="h-3 w-3 text-orange-600" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
});
TissRow.displayName = "TissRow";

function TissLoteListImpl({
  companyId,
  mes,
  ano,
  filterStatus,
  setFilterStatus,
  filterConvenio,
  setFilterConvenio,
  onSelectXml,
}: TissLoteListProps) {
  const { data: faturas, isLoading, isError, refetch } = useQuery({
    queryKey: ["tiss-xml", companyId, mes, ano, filterStatus, filterConvenio],
    queryFn: () =>
      tissService.listFaturas(companyId, {
        mes,
        ano,
        status: filterStatus === "ALL" ? undefined : filterStatus,
        cd_convenio: filterConvenio === "ALL" ? undefined : filterConvenio,
      }),
    enabled: !!companyId,
  });

  const { data: convenios } = useQuery({
    queryKey: ["insurance-companies"],
    queryFn: () => insuranceCompanyService.getAll(),
  });

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <Label className="text-xs">Mes</Label>
              <Select value={String(mes)} onValueChange={(v) => {
                // propagate up via re-fetching - parent controls mes state
                // we dispatch a custom event since mes is owned by parent
                const evt = new CustomEvent("tiss:mes-change", { detail: Number(v) });
                window.dispatchEvent(evt);
              }}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {String(m).padStart(2, "0")}/{ano}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as TissStatus | "ALL")}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  {(["PENDENTE", "ENVIADO", "PROCESSADO", "GLOSADO", "PAGO", "REJEITADO"] as TissStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{statusBadge(s).label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Convenio</Label>
              <Select
                value={String(filterConvenio)}
                onValueChange={(v) => setFilterConvenio(v === "ALL" ? "ALL" : Number(v))}
              >
                <SelectTrigger className="w-48"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  {(convenios || []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isError && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Nao foi possivel carregar as guias TISS</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>Os dados nao foram exibidos. Nenhuma operacao TISS foi executada.</span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lote</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Convenio</TableHead>
                <TableHead>Protocolo</TableHead>
                <TableHead>Informado</TableHead>
                <TableHead>Liberado</TableHead>
                <TableHead>Glosa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[260px]">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <RefreshCw className="h-4 w-4 animate-spin inline mr-2" />
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-destructive">
                    Guias indisponiveis no momento.
                  </TableCell>
                </TableRow>
              ) : (faturas || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    Nenhuma fatura encontrada para os filtros atuais.
                  </TableCell>
                </TableRow>
              ) : (
                (faturas || []).map((f) => (
                  <TissRow
                    key={f.id}
                    fatura={f}
                    onSelectXml={onSelectXml}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export const TissLoteList = memo(TissLoteListImpl);
TissLoteList.displayName = "TissLoteList";

export default TissLoteList;

