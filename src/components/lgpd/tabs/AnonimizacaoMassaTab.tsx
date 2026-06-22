/**
 * AnonimizacaoMassaTab — job de pacientes inativos > 5 anos
 * LGPD art. 18 VI + art. 16
 * Migration: 20260101000006_lgpd.sql
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { lgpdService } from "@/services/lgpdService";

interface AnonResult {
  sucesso: number;
  falha: number;
  erros: Array<{ id: number; erro: string }>;
}

export function AnonimizacaoMassaTab() {
  const [limit, setLimit] = useState(50);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [result, setResult] = useState<AnonResult | null>(null);

  const { data: candidatos, isLoading } = useQuery({
    queryKey: ["lgpd-anonimizaveis", limit],
    queryFn: () => lgpdService.getPacientesAnonimizaveis(limit),
  });

  const executarMassa = useMutation({
    mutationFn: () => lgpdService.executarAnonimizacaoMassa("INATIVO_5_ANOS", limit),
    onSuccess: (res: AnonResult) => {
      setResult(res);
      toast.success(`Anonimizacao concluida: ${res.sucesso} sucesso, ${res.falha} falhas`);
      setIsConfirmOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="h-5 w-5" />
          Anonimizacao em Massa
        </CardTitle>
        <CardDescription>
          Pacientes inativos ha mais de 5 anos sao anonimizados automaticamente
          (LGPD art. 18 VI + art. 16).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-md flex gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-700 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-yellow-900">Atencao — operacao irreversivel</p>
            <p className="text-yellow-800 mt-1">
              A anonimizacao zera PII do paciente (nome, CPF, endereco, telefone, etc).
              O registro permanece no sistema por razoes regulatorias/legais,
              mas todos os dados pessoais sao removidos.
            </p>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label>Limite de execucao</Label>
            <Input
              type="number"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              min={1}
              max={500}
            />
          </div>
          <Button
            variant="destructive"
            onClick={() => setIsConfirmOpen(true)}
            disabled={!candidatos || candidatos.length === 0}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Executar Anonimizacao ({candidatos?.length || 0} pacientes)
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Carregando candidatos...</div>
        ) : (candidatos || []).length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-30 text-green-500" />
            <p>Nenhum paciente anonimizavel no momento</p>
            <p className="text-xs mt-2">Pacientes inativos ha mais de 5 anos aparecerao aqui</p>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium mb-2">
              {candidatos?.length} paciente(s) candidato(s):
            </p>
            <div className="max-h-64 overflow-y-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>CPF</TableHead>
                    <TableHead>Inativo ha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidatos?.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>#{c.id}</TableCell>
                      <TableCell>{c.full_name}</TableCell>
                      <TableCell>{c.cpf || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{c.dias_sem_atendimento} dias</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {result && (
          <div className="bg-blue-50 border border-blue-200 p-4 rounded-md">
            <p className="font-medium">Resultado:</p>
            <ul className="text-sm mt-2 space-y-1">
              <li>Sucesso: {result.sucesso}</li>
              <li>Falha: {result.falha}</li>
              {result.erros.length > 0 && (
                <li>
                  Erros: {result.erros.map((e) => `ID ${e.id}: ${e.erro}`).join("; ")}
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Confirmacao */}
        <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirmar Anonimizacao em Massa</DialogTitle>
              <DialogDescription>
                Esta operacao e IRREVERSIVEL. Confirma a anonimizacao de{" "}
                <strong>{candidatos?.length || 0}</strong> pacientes inativos?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setIsConfirmOpen(false)}>Cancelar</Button>
              <Button
                variant="destructive"
                onClick={() => executarMassa.mutate()}
                disabled={executarMassa.isPending}
              >
                {executarMassa.isPending ? "Executando..." : "Confirmar e Executar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export default AnonimizacaoMassaTab;
