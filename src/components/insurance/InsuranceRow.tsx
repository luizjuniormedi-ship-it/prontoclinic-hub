/**
 * InsuranceRow — Linha memoizada para a lista de convênios
 * Sub-componente extraido de InsuranceManager para evitar re-renders
 * desnecessários ao filtrar, criar ou toggle.
 */

import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Power } from "lucide-react";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";
import type {
  InsuranceCompany,
  PaymentSource,
  PaymentSourceType,
} from "@/services/insuranceService";

const TYPE_COLORS: Record<PaymentSourceType, string> = {
  SUS: "bg-blue-100 text-blue-800",
  PARTICULAR: "bg-green-100 text-green-800",
  CORTESIA: "bg-gray-100 text-gray-800",
  CONVENIO: "bg-purple-100 text-purple-800",
};

export interface InsuranceRowProps {
  insurance: InsuranceCompany;
  paymentSource?: PaymentSource;
  onSelect: (c: InsuranceCompany) => void;
  onToggleActive: (id: number, ativo: boolean) => void;
}

function InsuranceRowImpl({ insurance, paymentSource, onSelect, onToggleActive }: InsuranceRowProps) {
  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => onSelect(insurance)}
    >
      <TableCell className="font-medium">{insurance.name}</TableCell>
      <TableCell>
        {paymentSource && (
          <Badge className={TYPE_COLORS[paymentSource.type]}>
            {paymentSource.type}
          </Badge>
        )}
      </TableCell>
      <TableCell>{insurance.registro_ans || "—"}</TableCell>
      <TableCell>{insurance.cnpj || "—"}</TableCell>
      <TableCell>
        <Badge variant={insurance.lg_ativo ? "default" : "secondary"}>
          {insurance.lg_ativo ? "Ativo" : "Inativo"}
        </Badge>
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onToggleActive(insurance.id, insurance.lg_ativo);
          }}
        >
          <Power className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function arePropsEqual(prev: InsuranceRowProps, next: InsuranceRowProps): boolean {
  return (
    prev.insurance === next.insurance &&
    prev.paymentSource === next.paymentSource &&
    prev.onSelect === next.onSelect &&
    prev.onToggleActive === next.onToggleActive
  );
}

export const InsuranceRow = memo(InsuranceRowImpl, arePropsEqual);
InsuranceRow.displayName = "InsuranceRow";

export default InsuranceRow;
