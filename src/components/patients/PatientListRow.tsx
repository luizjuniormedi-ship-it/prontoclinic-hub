/**
 * PatientListRow — Linha memoizada para listas de pacientes
 * Usado em PatientsPage e outras listas para evitar re-render quando
 * outras linhas mudam (filtro, busca, etc.)
 */

import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";

export interface PatientListRowData {
  id: string | number;
  name: string;
  cpf?: string;
  phone?: string;
  birthDate?: string;
  active?: boolean;
}

export interface PatientListRowProps {
  patient: PatientListRowData;
  onSelect?: (id: string | number) => void;
  onEdit?: (id: string | number) => void;
}

function calculateAge(birthDate?: string): number | null {
  if (!birthDate) return null;
  try {
    const b = new Date(birthDate);
    const diff = Date.now() - b.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
  } catch {
    return null;
  }
}

function PatientListRowImpl({ patient, onSelect, onEdit }: PatientListRowProps) {
  const age = calculateAge(patient.birthDate);
  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => onSelect?.(patient.id)}
    >
      <TableCell className="font-medium">{patient.name}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{patient.cpf || "—"}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{patient.phone || "—"}</TableCell>
      <TableCell className="text-xs">{age != null ? `${age}a` : "—"}</TableCell>
      <TableCell>
        <Badge variant={patient.active === false ? "secondary" : "default"}>
          {patient.active === false ? "Inativo" : "Ativo"}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        {onEdit && (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(patient.id);
            }}
          >
            Editar
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function arePropsEqual(prev: PatientListRowProps, next: PatientListRowProps): boolean {
  return (
    prev.patient.id === next.patient.id &&
    prev.patient.name === next.patient.name &&
    prev.patient.cpf === next.patient.cpf &&
    prev.patient.phone === next.patient.phone &&
    prev.patient.birthDate === next.patient.birthDate &&
    prev.patient.active === next.patient.active &&
    prev.onSelect === next.onSelect &&
    prev.onEdit === next.onEdit
  );
}

export const PatientListRow = memo(PatientListRowImpl, arePropsEqual);
PatientListRow.displayName = "PatientListRow";

export default PatientListRow;
