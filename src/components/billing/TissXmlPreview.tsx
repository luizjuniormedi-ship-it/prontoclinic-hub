/**
 * TissXmlPreview — Modal de detalhes da fatura TISS
 * Sub-componente extraido de TissManager.tsx
 */

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TissXml } from "@/services/tissService";
import {
  formatTissCurrency,
  formatTissInteger,
} from "./tissDisplay";

export interface TissXmlPreviewProps {
  xml: TissXml | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TissXmlPreview({ xml, open, onOpenChange }: TissXmlPreviewProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] w-[calc(100vw-2rem)] max-w-4xl overflow-y-auto">
        {!xml ? (
          <>
            <DialogHeader>
              <DialogTitle>Detalhes da Fatura</DialogTitle>
              <DialogDescription>Nenhuma fatura TISS foi selecionada.</DialogDescription>
            </DialogHeader>
            <div role="status" className="rounded border p-6 text-center text-sm text-muted-foreground">
              Selecione uma guia para visualizar seus dados.
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="break-words">
                Detalhes da Fatura #{formatTissInteger(xml.id)}
              </DialogTitle>
              <DialogDescription className="break-words">
                {xml.ds_descricao || "Sem descrição"} — {xml.dt_fatura || "data não informada"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div className="min-w-0 break-words"><b>Status:</b> {xml.status || "—"}</div>
                <div className="min-w-0 break-words"><b>Tipo Guia:</b> {xml.ds_tipo_guia || "—"}</div>
                <div className="min-w-0 break-words"><b>Lote:</b> {formatTissInteger(xml.cd_lote)}</div>
                <div className="min-w-0 break-all"><b>Protocolo:</b> {xml.ds_protocolo || "—"}</div>
                <div className="min-w-0 break-words"><b>Informado:</b> {formatTissCurrency(xml.vl_informado)}</div>
                <div className="min-w-0 break-words"><b>Liberado:</b> {formatTissCurrency(xml.vl_liberado)}</div>
                <div className="min-w-0 break-words"><b>Glosa:</b> {formatTissCurrency(xml.vl_glosa)}</div>
                <div className="min-w-0 break-words"><b>Versao TISS:</b> {xml.ds_versao_tiss || "—"}</div>
              </div>

              {xml.bl_xml_enviado && (
                <div>
                  <Label className="text-xs">XML Enviado</Label>
                  <Textarea readOnly value={xml.bl_xml_enviado} rows={6} className="font-mono text-xs" />
                </div>
              )}
              {xml.bl_xml_retorno && (
                <div>
                  <Label className="text-xs">XML de Retorno</Label>
                  <Textarea readOnly value={xml.bl_xml_retorno} rows={6} className="font-mono text-xs" />
                </div>
              )}
              {xml.ds_motivo_rejeicao && (
                <div className="p-3 bg-red-50 text-red-800 rounded">
                  <b>Motivo da rejeicao:</b> {xml.ds_motivo_rejeicao}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default TissXmlPreview;
