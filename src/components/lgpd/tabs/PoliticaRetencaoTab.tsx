/**
 * PoliticaRetencaoTab — CRUD por tabela (LGPD art. 16)
 * Migration: 20260101000006_lgpd.sql
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Archive, AlertTriangle, Database } from "lucide-react";
import { toast } from "sonner";
import {
  lgpdService,
  POLITICA_PADRAO,
  type LgpdPoliticaRetencao,
  type AcaoRetencao,
} from "@/services/lgpdService";

export function PoliticaRetencaoTab() {
  const [companyId, setCompanyId] = useState(""); // Vem do contexto de auth
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [novaPolitica, setNovaPolitica] = useState<{ tabela: string; dias: number; acao: AcaoRetencao }>({
    tabela: "",
    dias: 1825,
    acao: "ARQUIVAR",
  });
  const queryClient = useQueryClient();

  const { data: politicas, isLoading } = useQuery({
    queryKey: ["lgpd-politica", companyId],
    queryFn: () => lgpdService.getPoliticaRetencao(companyId),
    enabled: !!companyId,
  });

  const salvarPolitica = useMutation({
    mutationFn: () =>
      lgpdService.setPoliticaRetencao(companyId, novaPolitica.tabela, novaPolitica.dias, novaPolitica.acao),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lgpd-politica", companyId] });
      toast.success("Politica salva");
      setIsDialogOpen(false);
      setNovaPolitica({ tabela: "", dias: 1825, acao: "ARQUIVAR" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const seedPadrao = useMutation({
    mutationFn: () => lgpdService.seedPoliticaPadrao(companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lgpd-politica", companyId] });
      toast.success("Politica padrao aplicada");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const acaoBadge = (a: AcaoRetencao) => {
    const map: Record<AcaoRetencao, string> = {
      ANONIMIZAR: "bg-yellow-100 text-yellow-800",
      DELETAR: "bg-red-100 text-red-800",
      ARQUIVAR: "bg-blue-100 text-blue-800",
    };
    return <Badge className={map[a]}>{a}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            Politica de Retencao
          </CardTitle>
          <CardDescription>
            LGPD art. 16 — retencao de dados por tabela com acao apos expirar.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => seedPadrao.mutate()} disabled={!companyId || seedPadrao.isPending}>
            Aplicar Padrao
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={!companyId}>Nova Politica</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova Politica de Retencao</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Tabela</Label>
                  <Input
                    value={novaPolitica.tabela}
                    onChange={(e) => setNovaPolitica({ ...novaPolitica, tabela: e.target.value })}
                    placeholder="Ex: appointments, medical_records"
                  />
                </div>
                <div>
                  <Label>Dias de Retencao</Label>
                  <Input
                    type="number"
                    value={novaPolitica.dias}
                    onChange={(e) => setNovaPolitica({ ...novaPolitica, dias: Number(e.target.value) })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    1825 = 5 anos | 7300 = 20 anos
                  </p>
                </div>
                <div>
                  <Label>Acao apos expirar</Label>
                  <Select
                    value={novaPolitica.acao}
                    onValueChange={(v) => setNovaPolitica({ ...novaPolitica, acao: v as AcaoRetencao })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARQUIVAR">Arquivar (cold storage)</SelectItem>
                      <SelectItem value="ANONIMIZAR">Anonimizar</SelectItem>
                      <SelectItem value="DELETAR">Deletar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                <Button onClick={() => salvarPolitica.mutate()} disabled={!novaPolitica.tabela || salvarPolitica.isPending}>
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!companyId && (
          <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-md flex gap-2 items-center text-sm">
            <AlertTriangle className="h-4 w-4 text-yellow-700" />
            <span>Company ID nao identificado — verifique o contexto de autenticacao.</span>
          </div>
        )}

        <div>
          <Label>Company ID (temporario)</Label>
          <Input
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            placeholder="UUID da empresa"
          />
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Carregando...</div>
        ) : (politicas || []).length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Database className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nenhuma politica configurada</p>
            <p className="text-xs mt-2">
              Recomendado: <code>POLITICA_PADRAO</code> disponivel no service
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tabela</TableHead>
                <TableHead>Dias</TableHead>
                <TableHead>Anos</TableHead>
                <TableHead>Acao</TableHead>
                <TableHead>Atualizado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(politicas || []).map((p: LgpdPoliticaRetencao) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono">{p.tabela}</TableCell>
                  <TableCell>{p.dias_retencao}</TableCell>
                  <TableCell>{(p.dias_retencao / 365).toFixed(1)} anos</TableCell>
                  <TableCell>{acaoBadge(p.acao_apos_expirar)}</TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {new Date(p.updated_at).toLocaleString("pt-BR")}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Politica padrao de referencia */}
        <details className="border rounded-md p-3">
          <summary className="cursor-pointer font-medium">Ver politica padrao recomendada</summary>
          <Table className="mt-2">
            <TableHeader>
              <TableRow>
                <TableHead>Tabela</TableHead>
                <TableHead>Dias</TableHead>
                <TableHead>Acao</TableHead>
                <TableHead>Justificativa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {POLITICA_PADRAO.map((p) => (
                <TableRow key={p.tabela}>
                  <TableCell className="font-mono">{p.tabela}</TableCell>
                  <TableCell>{p.dias}</TableCell>
                  <TableCell>{acaoBadge(p.acao)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.justificativa}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>
      </CardContent>
    </Card>
  );
}

export default PoliticaRetencaoTab;
