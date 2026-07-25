/**
 * LGPDManager — Orquestrador do modulo LGPD
 *
 * Tabs:
 *   1. Consentimentos    — src/components/lgpd/tabs/ConsentimentosTab.tsx
 *   2. Solicitacoes      — src/components/lgpd/tabs/SolicitacoesTab.tsx
 *   3. Politica Retencao — src/components/lgpd/tabs/PoliticaRetencaoTab.tsx
 *   4. Anonimizacao      — src/components/lgpd/tabs/AnonimizacaoMassaTab.tsx
 *   5. Auditoria         — src/components/lgpd/tabs/AuditoriaAcessoTab.tsx
 *
 * Migration: 20260101000006_lgpd.sql
 * Service:   src/services/lgpdService.ts
 */

import { Shield } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ConsentimentosTab } from "./tabs/ConsentimentosTab";
import { SolicitacoesTab } from "./tabs/SolicitacoesTab";
import { PoliticaRetencaoTab } from "./tabs/PoliticaRetencaoTab";
import { AnonimizacaoMassaTab } from "./tabs/AnonimizacaoMassaTab";
import { AuditoriaAcessoTab } from "./tabs/AuditoriaAcessoTab";

export function LGPDManager() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6" />
          Modulo LGPD
        </h1>
        <p className="text-muted-foreground">
          Gestao completa de conformidade com a Lei Geral de Protecao de Dados (13.709/2018)
        </p>
      </div>

      <Tabs defaultValue="consentimentos" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="consentimentos">Consentimentos</TabsTrigger>
          <TabsTrigger value="solicitacoes">Solicitacoes</TabsTrigger>
          <TabsTrigger value="politica">Politica Retencao</TabsTrigger>
          <TabsTrigger value="anonimizacao">Anonimizacao</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
        </TabsList>

        <TabsContent value="consentimentos"><ConsentimentosTab /></TabsContent>
        <TabsContent value="solicitacoes"><SolicitacoesTab /></TabsContent>
        <TabsContent value="politica"><PoliticaRetencaoTab /></TabsContent>
        <TabsContent value="anonimizacao"><AnonimizacaoMassaTab /></TabsContent>
        <TabsContent value="auditoria"><AuditoriaAcessoTab /></TabsContent>
      </Tabs>
    </div>
  );
}

export default LGPDManager;
