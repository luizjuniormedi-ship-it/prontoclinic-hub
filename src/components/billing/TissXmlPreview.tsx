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

export interface TissXmlPreviewProps {
  xml: TissXml | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TissXmlPreview({ xml, open, onOpenChange }: TissXmlPreviewProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        {xml && (
          <>
            <DialogHeader>
              <DialogTitle>Detalhes da Fatura #{xml.id}</DialogTitle>
              <DialogDescription>
                {xml.ds_descricao} — {xml.dt_fatura}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><b>Status:</b> {xml.status}</div>
                <div><b>Tipo Guia:</b> {xml.ds_tipo_guia}</div>
                <div><b>Lote:</b> {xml.cd_lote || "—"}</div>
                <div><b>Protocolo:</b> {xml.ds_protocolo || "—"}</div>
                <div><b>Informado:</b> R$ {(xml.vl_informado || 0).toFixed(2)}</div>
                <div><b>Liberado:</b> R$ {(xml.vl_liberado || 0).toFixed(2)}</div>
                <div><b>Glosa:</b> R$ {(xml.vl_glosa || 0).toFixed(2)}</div>
                <div><b>Versao TISS:</b> {xml.ds_versao_tiss}</div>
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

export function downloadXml(f: TissXml) {
  if (!f.bl_xml_enviado) return;
  const blob = new Blob([f.bl_xml_enviado], { type: "text/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.ds_filename || `tiss_${f.id}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

export default TissXmlPreview;
