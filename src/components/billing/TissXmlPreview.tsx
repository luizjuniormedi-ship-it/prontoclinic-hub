/**
 * TissXmlPreview — Modal de detalhes da fatura TISS
 * Sub-componente extraido de TissManager.tsx
 */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TissReadModel } from "@/services/tissService";

export interface TissXmlPreviewProps {
  xml: TissReadModel | null;
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
              <DialogTitle>Registro TISS #{xml.tiss_xml_id}</DialogTitle>
              <DialogDescription>
                Referencias canonicas de faturamento em modo somente leitura.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><b>Fatura:</b> {xml.billing_id ? `#${xml.billing_id}` : "—"}</div>
                <div><b>Atendimento:</b> {xml.appointment_id ? `#${xml.appointment_id}` : "—"}</div>
                <div><b>Paciente:</b> {xml.patient_id ? `#${xml.patient_id}` : "—"}</div>
                <div><b>Operadora:</b> {xml.insurance_company_name || "—"}</div>
                <div><b>Plano:</b> {xml.insurance_plan_name || "—"}</div>
                <div><b>Valor:</b> {xml.billing_amount === null ? "—" : xml.billing_amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</div>
                <div><b>Criado em:</b> {new Date(xml.tiss_created_at).toLocaleString("pt-BR")}</div>
              </div>
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
