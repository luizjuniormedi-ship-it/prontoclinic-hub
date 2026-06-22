/**
 * AuditLogRow — Linha memoizada para tabela de auditoria
 * Extraido de AuditLogViewer para evitar re-render em massa quando
 * apenas uma linha muda (ex: ao filtrar).
 */

import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";

const ACAO_CORES: Record<string, string> = {
  INSERT: "bg-green-100 text-green-800",
  UPDATE: "bg-blue-100 text-blue-800",
  DELETE: "bg-red-100 text-red-800",
  LOGIN: "bg-slate-100 text-slate-800",
  LOGOUT: "bg-slate-100 text-slate-800",
  EXPORT: "bg-purple-100 text-purple-800",
  ANONYMIZE: "bg-yellow-100 text-yellow-800",
  VIEW_RECORD: "bg-cyan-100 text-cyan-800",
  PRINT: "bg-orange-100 text-orange-800",
};

export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncateId(id?: string | null, len = 12): string {
  if (!id) return "—";
  if (id.length <= len) return id;
  return `${id.slice(0, len)}…`;
}

export interface AuditLogRowData {
  id: string;
  createdAt: string;
  userName: string;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}

export interface AuditLogRowProps {
  log: AuditLogRowData;
  onView: (log: AuditLogRowData) => void;
}

function AuditLogRowImpl({ log, onView }: AuditLogRowProps) {
  const cor = ACAO_CORES[log.action] ?? "bg-gray-100 text-gray-800";
  const role =
    (log.details?.role_name as string | undefined) ?? "—";
  const ip =
    (log.details?.ip_origem as string | undefined) ?? "—";
  return (
    <TableRow key={`${log.id}-${log.createdAt}`}>
      <TableCell className="font-mono text-xs">
        {formatDateTime(log.createdAt)}
      </TableCell>
      <TableCell>{log.userName}</TableCell>
      <TableCell>
        <Badge variant="outline">{role}</Badge>
      </TableCell>
      <TableCell>
        <Badge className={cor}>{log.action}</Badge>
      </TableCell>
      <TableCell className="font-mono text-xs">{log.entity}</TableCell>
      <TableCell className="font-mono text-xs">
        {truncateId(log.entityId)}
      </TableCell>
      <TableCell className="font-mono text-xs">{ip}</TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onView(log)}
        >
          Ver
        </Button>
      </TableCell>
    </TableRow>
  );
}

function arePropsEqual(prev: AuditLogRowProps, next: AuditLogRowProps): boolean {
  // log é a referência primária; re-render somente se id+mudança real
  return (
    prev.log.id === next.log.id &&
    prev.log.createdAt === next.log.createdAt &&
    prev.log.action === next.log.action &&
    prev.onView === next.onView
  );
}

export const AuditLogRow = memo(AuditLogRowImpl, arePropsEqual);
AuditLogRow.displayName = "AuditLogRow";

export default AuditLogRow;
