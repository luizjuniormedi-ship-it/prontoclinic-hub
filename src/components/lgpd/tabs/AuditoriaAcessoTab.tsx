/**
 * AuditoriaAcessoTab — integracao com Agente 3 (auditoria real)
 * LGPD art. 37 — trilha de quem acessou dados sensiveis
 * Migration: 20260101000007_audit_logs.sql
 */

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileDown, History } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface AuditLogRow {
  id: string | number;
  created_at: string;
  user_name?: string | null;
  user_id?: string | null;
  action: string;
  entity: string;
  entity_id: string | number;
}

export function AuditoriaAcessoTab() {
  // Integracao com Agente 3 (auditoria real) — query direta em audit_logs
  const { data: logs, isLoading } = useQuery({
    queryKey: ["lgpd-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as AuditLogRow[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileDown className="h-5 w-5" />
          Auditoria de Acesso
        </CardTitle>
        <CardDescription>
          Trilha de quem acessou dados sensiveis (LGPD art. 37). Integracao com Agente 3.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Carregando...</div>
        ) : (logs || []).length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum log de auditoria registrado</p>
            <p className="text-xs mt-2">
              Acesse dados de pacientes para gerar logs automaticamente
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Acao</TableHead>
                <TableHead>Entidade</TableHead>
                <TableHead>ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs?.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>
                    <span className="text-xs">
                      {new Date(log.created_at).toLocaleString("pt-BR")}
                    </span>
                  </TableCell>
                  <TableCell>{log.user_name || log.user_id}</TableCell>
                  <TableCell><Badge variant="outline">{log.action}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{log.entity}</TableCell>
                  <TableCell className="font-mono text-xs">{log.entity_id}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default AuditoriaAcessoTab;
