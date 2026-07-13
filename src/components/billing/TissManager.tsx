/**
 * TissManager — Orquestrador de faturamento eletronico TISS/XML
 *
 * Espelha SIGH.xml (544 registros) + SIGH.recurso_de_glosa
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
import { tissService, type TissStatus, type TissXml } from "@/services/tissService";
import { useAuth } from "@/hooks/useAuth";
import { TissStats } from "./TissStats";
import { TissLoteList } from "./TissLoteList";
import { TissGuiaForm } from "./TissGuiaForm";
import { TissXmlPreview } from "./TissXmlPreview";

export function TissManager() {
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

  const handleSelectXml = (xml: TissXml) => {
    setSelectedXml(xml);
    setGlosaDialogOpen(false);
  };

  const handleOpenGlosa = (xml: TissXml) => {
    setSelectedXml(xml);
    setGlosaDialogOpen(true);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Faturamento TISS</h1>
          <p className="text-muted-foreground">
            XMLs de faturamento eletronico de convenios (espelha SIGH.xml)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setProtocolDialogOpen(true)}>
            <Settings2 className="h-4 w-4 mr-1" />Protocolos
          </Button>
          <Button disabled title="Geracao indisponivel ate ativacao da RPC TISS segura">
            <RefreshCw className="h-4 w-4 mr-1" />
            Gerar Fatura do Mes
          </Button>
        </div>
      </div>

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

      <Tabs defaultValue="guias" className="w-full">
        <TabsList>
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
