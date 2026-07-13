/**
 * TissLoteList — Tabela de lotes TISS com filtros
 * Sub-componente extraido de TissManager.tsx
 */

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Eye,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import {
  tissService,
  type TissReadModel,
} from "@/services/tissService";
import { insuranceCompanyService } from "@/services/insuranceService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface TissLoteListProps {
  companyId?: string;
  mes: number;
  ano: number;
  filterConvenio: number | "ALL";
  setFilterConvenio: (v: number | "ALL") => void;
  onSelectXml: (xml: TissReadModel) => void;
}

interface TissRowProps {
  fatura: TissReadModel;
  onSelectXml: (xml: TissReadModel) => void;
}

const TissRow = memo(function TissRow({ fatura, onSelectXml }: TissRowProps) {
  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => onSelectXml(fatura)}
    >
      <TableCell><code className="text-xs">#{fatura.tiss_xml_id}</code></TableCell>
      <TableCell><code className="text-xs">{fatura.billing_id ? `#${fatura.billing_id}` : "—"}</code></TableCell>
      <TableCell className="text-xs">{fatura.insurance_company_name || "—"}</TableCell>
      <TableCell className="text-xs">{fatura.insurance_plan_name || "—"}</TableCell>
      <TableCell>
        {fatura.billing_amount === null
          ? "—"
          : fatura.billing_amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </TableCell>
      <TableCell className="text-xs">
        {new Date(fatura.tiss_created_at).toLocaleDateString("pt-BR")}
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
        </div>
      </TableCell>
    </TableRow>
  );
});
TissRow.displayName = "TissRow";

function TissLoteListImpl({
  mes,
  ano,
  filterConvenio,
  setFilterConvenio,
  onSelectXml,
}: TissLoteListProps) {
  const { data: faturas, isLoading, isError, refetch } = useQuery({
    queryKey: ["tiss-xml", mes, ano, filterConvenio],
    queryFn: () =>
      tissService.listFaturas({
        mes,
        ano,
        insurance_company_id: filterConvenio === "ALL" ? undefined : filterConvenio,
      }),
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
                <TableHead>Registro TISS</TableHead>
                <TableHead>Fatura</TableHead>
                <TableHead>Operadora</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="w-[260px]">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <RefreshCw className="h-4 w-4 animate-spin inline mr-2" />
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-destructive">
                    Guias indisponiveis no momento.
                  </TableCell>
                </TableRow>
              ) : (faturas || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Nenhuma fatura encontrada para os filtros atuais.
                  </TableCell>
                </TableRow>
              ) : (
                (faturas || []).map((f) => (
                  <TissRow
                    key={f.tiss_xml_id}
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
