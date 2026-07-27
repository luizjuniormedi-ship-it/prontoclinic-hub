/**
 * TissManager — Orquestrador de faturamento eletronico TISS/XML
 *
 * Gerencia guias, lotes, retornos e recursos do dominio TISS.
 *
 * Sub-componentes:
 *   - TissStats.tsx       — totalizadores + graficos
 *   - TissLoteList.tsx    — tabela de faturas
 *   - TissGuiaForm.tsx    — dialogs de glosa/protocolo
 *   - TissXmlPreview.tsx  — modal de detalhes
 *
 * Migration: 20260101000010_tiss.sql
 */

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { tissService, type TissStatus, type TissXml } from "@/services/tissService";
import { useAuth } from "@/hooks/useAuth";
import { TissStats } from "./TissStats";
import { TissLoteList } from "./TissLoteList";
import { TissGuiaForm } from "./TissGuiaForm";
import { TissXmlPreview } from "./TissXmlPreview";
import {
  formatTissCurrency,
  formatTissInteger,
} from "./tissDisplay";

export function TissManager() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // companyId era acessado do useAuth legado; hoje vem do user.company_id
  const companyId = user?.company_id ?? "";
  const hoje = new Date();
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [ano, setAno] = useState(hoje.getFullYear());
  const [filterStatus, setFilterStatus] = useState<TissStatus | "ALL">("ALL");
  const [filterConvenio, setFilterConvenio] = useState<number | "ALL">("ALL");
  const [selectedXml, setSelectedXml] = useState<TissXml | null>(null);
  const [glosaDialogOpen, setGlosaDialogOpen] = useState(false);
  const [protocolDialogOpen, setProtocolDialogOpen] = useState(false);

  // Listen to cross-component mes-change events from TissLoteList
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<number>;
      if (typeof ce.detail === "number") setMes(ce.detail);
    };
    window.addEventListener("tiss:mes-change", handler);
    return () => window.removeEventListener("tiss:mes-change", handler);
  }, []);

  const generateMonthMutation = useMutation({
    mutationFn: () => tissService.gerarFaturaMensal(mes, ano, companyId),
    onSuccess: async (r) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tiss-xml"] }),
        queryClient.invalidateQueries({ queryKey: ["tiss-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["tiss-status-distribution"] }),
      ]);
      toast.success(
        `Lote ${r.lote}: ${formatTissInteger(r.total_xmls)} XMLs gerados, ${formatTissCurrency(r.vl_total)}`,
      );
    },
    onError: (e: Error) => toast.error(`Erro: ${e.message}`),
  });

  const handleGenerateMonth = () => {
    const competence = `${String(mes).padStart(2, "0")}/${ano}`;
    const confirmed = window.confirm(
      `Confirmar geração idempotente da competência TISS ${competence}?`
    );
    if (confirmed) {
      generateMonthMutation.mutate();
    }
  };

  const handleSelectXml = (xml: TissXml) => {
    setSelectedXml(xml);
    setGlosaDialogOpen(false);
  };

  const handleOpenGlosa = (xml: TissXml) => {
    setSelectedXml(xml);
    setGlosaDialogOpen(true);
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Faturamento TISS</h1>
          <p className="text-muted-foreground break-words">
            Guias e lotes eletrônicos de faturamento por convênio
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button className="w-full sm:w-auto" variant="outline" onClick={() => setProtocolDialogOpen(true)}>
            <Settings2 className="h-4 w-4 mr-1" />Protocolos
          </Button>
          <Button
            className="w-full sm:w-auto"
            onClick={handleGenerateMonth}
            disabled={generateMonthMutation.isPending || !companyId}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            {generateMonthMutation.isPending ? "Gerando..." : "Gerar Fatura do Mes"}
          </Button>
        </div>
      </div>

      {!companyId && (
        <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Empresa não identificada. As operações TISS permanecem bloqueadas até a sessão ser restabelecida.
        </div>
      )}

      {/* Totalizadores + charts (sub-componente) */}
      <TissStats companyId={companyId} ano={ano} />

      {/* Selecao de ano (compartilhada entre abas) */}
      <div className="flex items-center gap-2">
        <Label className="text-xs">Ano</Label>
        <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[ano - 1, ano, ano + 1].map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="guias" className="w-full min-w-0">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="guias">Guias TISS</TabsTrigger>
          <TabsTrigger value="charts">Graficos</TabsTrigger>
          <TabsTrigger value="glosas">Glosas</TabsTrigger>
        </TabsList>

        <TabsContent value="guias" className="space-y-3">
          <TissLoteList
            companyId={companyId}
            mes={mes}
            ano={ano}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            filterConvenio={filterConvenio}
            setFilterConvenio={setFilterConvenio}
            onSelectXml={handleSelectXml}
            onOpenGlosa={handleOpenGlosa}
          />
        </TabsContent>

        <TabsContent value="charts" className="space-y-4">
          <TissStats companyId={companyId} ano={ano} />
        </TabsContent>

        <TabsContent value="glosas" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Glosas em aberto. Selecione uma fatura GLOSADA na aba "Guias TISS" para enviar recurso.
          </p>
        </TabsContent>
      </Tabs>

      {/* Modal de Detalhes (preview) */}
      <TissXmlPreview
        xml={selectedXml}
        open={!!selectedXml && !glosaDialogOpen}
        onOpenChange={(o) => !o && setSelectedXml(null)}
      />

      {/* Dialogs de formularios (glosa + protocolo) */}
      <TissGuiaForm
        glosaDialogOpen={glosaDialogOpen}
        setGlosaDialogOpen={setGlosaDialogOpen}
        selectedXml={selectedXml}
        protocolDialogOpen={protocolDialogOpen}
        setProtocolDialogOpen={setProtocolDialogOpen}
        companyId={companyId}
      />
    </div>
  );
}

export default TissManager;
