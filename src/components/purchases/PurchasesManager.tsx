/**
 * PurchasesManager — UI principal do módulo de Compras e Suprimentos.
 *
 * Três abas:
 *   - Fornecedores: cadastro de fornecedores com busca, toggle ativo/inativo
 *   - Cotações: lista de cotações com seus itens, criação via dialog
 *   - Ordens de Compra: lista filtrável, status visual colorido, aprovação
 *
 * Decisões:
 *   - Componente dividido em sub-componentes internos (FornecedoresTab,
 *     CotacoesTab, OCsTab) para manter legibilidade e evitar god-component.
 *   - Todos os dados vêm via TanStack Query + purchasesService (Zod-validado).
 *   - Mutations invalidam as queries relevantes no cache.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Truck, FileText, ShoppingCart, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
  fornecedoresService,
  cotacoesService,
  ordensCompraService,
  type Fornecedor,
  type OrdemCompra,
  type Cotacao,
} from "@/services/purchasesService";
import { PurchaseOrderForm } from "./PurchaseOrderForm";
import { useConfirm } from "@/hooks/useConfirm";

const STATUS_OC_BADGE: Record<OrdemCompra["tp_status"], "default" | "secondary" | "destructive" | "outline"> = {
  PENDENTE: "outline",
  APROVADA: "secondary",
  ENVIADA: "default",
  RECEBIDA: "default",
  CANCELADA: "destructive",
};

const STATUS_OC_COLOR: Record<OrdemCompra["tp_status"], string> = {
  PENDENTE: "bg-amber-100 text-amber-900",
  APROVADA: "bg-blue-100 text-blue-900",
  ENVIADA: "bg-indigo-100 text-indigo-900",
  RECEBIDA: "bg-green-100 text-green-900",
  CANCELADA: "bg-red-100 text-red-900",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function FornecedoresTab() {
  const [search, setSearch] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState<string>("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState({
    nm_razao_social: "",
    nm_fantasia: "",
    cd_cnpj: "",
    ds_email: "",
    ds_contato: "",
    nr_telefone: "",
    tp_fornecedor: "MATERIAIS" as Fornecedor["tp_fornecedor"],
    vl_prazo_pagto_dias: 30,
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: fornecedores, isLoading } = useQuery({
    queryKey: ["fornecedores"],
    queryFn: () => fornecedoresService.getAll(),
  });

  const createMut = useMutation({
    mutationFn: fornecedoresService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fornecedores"] });
      setIsDialogOpen(false);
      setForm({ nm_razao_social: "", nm_fantasia: "", cd_cnpj: "", ds_email: "", ds_contato: "", nr_telefone: "", tp_fornecedor: "MATERIAIS", vl_prazo_pagto_dias: 30 });
      toast({ title: "Fornecedor criado com sucesso" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      fornecedoresService.toggleAtivo(id, ativo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fornecedores"] }),
  });

  const filtered = useMemo(() => {
    return (fornecedores ?? []).filter((f) => {
      const matchSearch =
        !search ||
        f.nm_razao_social.toLowerCase().includes(search.toLowerCase()) ||
        (f.nm_fantasia?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
        (f.cd_cnpj?.includes(search) ?? false);
      const matchTipo = !tipoFiltro || tipoFiltro === "ALL" || f.tp_fornecedor === tipoFiltro;
      return matchSearch && matchTipo;
    });
  }, [fornecedores, search, tipoFiltro]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMut.mutate({
      nm_razao_social: form.nm_razao_social,
      nm_fantasia: form.nm_fantasia || null,
      cd_cnpj: form.cd_cnpj || null,
      ds_email: form.ds_email || null,
      ds_contato: form.ds_contato || null,
      nr_telefone: form.nr_telefone || null,
      tp_fornecedor: form.tp_fornecedor,
      vl_prazo_pagto_dias: form.vl_prazo_pagto_dias,
      lg_ativo: true,
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" />Fornecedores</CardTitle>
            <CardDescription>Cadastro e gestão de fornecedores da clínica.</CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Novo Fornecedor</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo Fornecedor</DialogTitle>
                <DialogDescription>Preencha os dados do fornecedor.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <Label htmlFor="razao">Razão Social *</Label>
                  <Input id="razao" required value={form.nm_razao_social} onChange={(e) => setForm({ ...form, nm_razao_social: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="fantasia">Nome Fantasia</Label>
                    <Input id="fantasia" value={form.nm_fantasia} onChange={(e) => setForm({ ...form, nm_fantasia: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="cnpj">CNPJ</Label>
                    <Input id="cnpj" maxLength={14} value={form.cd_cnpj} onChange={(e) => setForm({ ...form, cd_cnpj: e.target.value.replace(/\D/g, "") })} placeholder="14 dígitos" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={form.ds_email} onChange={(e) => setForm({ ...form, ds_email: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="tel">Telefone</Label>
                    <Input id="tel" value={form.nr_telefone} onChange={(e) => setForm({ ...form, nr_telefone: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="contato">Contato</Label>
                  <Input id="contato" value={form.ds_contato} onChange={(e) => setForm({ ...form, ds_contato: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="tipo">Tipo</Label>
                    <Select value={form.tp_fornecedor ?? undefined} onValueChange={(v) => setForm({ ...form, tp_fornecedor: v as Fornecedor["tp_fornecedor"] })}>
                      <SelectTrigger id="tipo"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MEDICAMENTOS">Medicamentos</SelectItem>
                        <SelectItem value="MATERIAIS">Materiais</SelectItem>
                        <SelectItem value="EQUIPAMENTOS">Equipamentos</SelectItem>
                        <SelectItem value="SERVICOS">Serviços</SelectItem>
                        <SelectItem value="OUTROS">Outros</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="prazo">Prazo Pgto (dias)</Label>
                    <Input id="prazo" type="number" min={0} value={form.vl_prazo_pagto_dias} onChange={(e) => setForm({ ...form, vl_prazo_pagto_dias: Number(e.target.value) })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={createMut.isPending}>
                    {createMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Cadastrar
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar por razão social, fantasia ou CNPJ" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={tipoFiltro} onValueChange={setTipoFiltro}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Todos os tipos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os tipos</SelectItem>
              <SelectItem value="MEDICAMENTOS">Medicamentos</SelectItem>
              <SelectItem value="MATERIAIS">Materiais</SelectItem>
              <SelectItem value="EQUIPAMENTOS">Equipamentos</SelectItem>
              <SelectItem value="SERVICOS">Serviços</SelectItem>
              <SelectItem value="OUTROS">Outros</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Razão Social</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground p-6">Nenhum fornecedor encontrado.</TableCell></TableRow>
              ) : (
                filtered.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <div className="font-medium">{f.nm_razao_social}</div>
                      {f.nm_fantasia && <div className="text-xs text-muted-foreground">{f.nm_fantasia}</div>}
                    </TableCell>
                    <TableCell>{f.cd_cnpj ? f.cd_cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : "—"}</TableCell>
                    <TableCell><Badge variant="outline">{f.tp_fornecedor ?? "—"}</Badge></TableCell>
                    <TableCell>{f.vl_prazo_pagto_dias} dias</TableCell>
                    <TableCell>
                      <Badge variant={f.lg_ativo ? "default" : "secondary"}>{f.lg_ativo ? "Ativo" : "Inativo"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => toggleMut.mutate({ id: f.id, ativo: f.lg_ativo })}>
                        {f.lg_ativo ? "Desativar" : "Ativar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CotacoesTab() {
  const { data: cotacoes, isLoading } = useQuery({
    queryKey: ["cotacoes"],
    queryFn: () => cotacoesService.getAll(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Cotações</CardTitle>
        <CardDescription>Cotações comparativas com múltiplos fornecedores.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Observações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(cotacoes ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground p-6">Nenhuma cotação cadastrada.</TableCell></TableRow>
              ) : (
                (cotacoes ?? []).map((c: Cotacao) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono">{c.nr_cotacao}</TableCell>
                    <TableCell>{new Date(c.dt_cotacao).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell>{c.dt_validade ? new Date(c.dt_validade).toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell><Badge variant="outline">{c.tp_status}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.ds_observacoes ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function OCsTab() {
  const { promptText } = useConfirm();
  const [statusFiltro, setStatusFiltro] = useState<string>("");
  const [selected, setSelected] = useState<OrdemCompra | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: ocs, isLoading } = useQuery({
    queryKey: ["ordens-compra", statusFiltro],
    queryFn: () => ordensCompraService.getAll({ status: statusFiltro && statusFiltro !== "ALL" ? statusFiltro as OrdemCompra["tp_status"] : undefined }),
  });

  const updateStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: OrdemCompra["tp_status"] }) =>
      ordensCompraService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ordens-compra"] });
      toast({ title: "Status atualizado" });
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" />Ordens de Compra</CardTitle>
            <CardDescription>Gestão de OCs: pendente, aprovada, enviada, recebida.</CardDescription>
          </div>
          <Button onClick={() => { setSelected(null); setIsFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />Nova OC
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <Select value={statusFiltro} onValueChange={setStatusFiltro}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Todos os status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos</SelectItem>
              <SelectItem value="PENDENTE">Pendente</SelectItem>
              <SelectItem value="APROVADA">Aprovada</SelectItem>
              <SelectItem value="ENVIADA">Enviada</SelectItem>
              <SelectItem value="RECEBIDA">Recebida</SelectItem>
              <SelectItem value="CANCELADA">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OC</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(ocs ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground p-6">Nenhuma ordem de compra.</TableCell></TableRow>
              ) : (
                (ocs ?? []).map((oc) => (
                  <TableRow key={oc.id}>
                    <TableCell className="font-mono">{oc.nr_ordem}</TableCell>
                    <TableCell>{new Date(oc.dt_emissao).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell>{formatCurrency(oc.vl_total)}</TableCell>
                    <TableCell><Badge className={STATUS_OC_COLOR[oc.tp_status]} variant="outline">{oc.tp_status}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {oc.tp_status === "PENDENTE" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatusMut.mutate({ id: oc.id, status: "APROVADA" })}>Aprovar</Button>
                        )}
                        {oc.tp_status === "APROVADA" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatusMut.mutate({ id: oc.id, status: "ENVIADA" })}>Marcar Enviada</Button>
                        )}
                        {oc.tp_status === "ENVIADA" && (
                          <Button size="sm" variant="outline" onClick={async () => {
                            const nf = await promptText({ title: "Receber ordem de compra", label: "Número da Nota Fiscal", required: true });
                            if (nf) updateStatusMut.mutate({ id: oc.id, status: "RECEBIDA" });
                          }}>Receber</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {isFormOpen && (
        <PurchaseOrderForm
          onClose={() => setIsFormOpen(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ["ordens-compra"] });
            setIsFormOpen(false);
          }}
        />
      )}
    </Card>
  );
}

export function PurchasesManager() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="fornecedores">
        <TabsList>
          <TabsTrigger value="fornecedores">Fornecedores</TabsTrigger>
          <TabsTrigger value="cotacoes">Cotações</TabsTrigger>
          <TabsTrigger value="ocs">Ordens de Compra</TabsTrigger>
        </TabsList>
        <TabsContent value="fornecedores"><FornecedoresTab /></TabsContent>
        <TabsContent value="cotacoes"><CotacoesTab /></TabsContent>
        <TabsContent value="ocs"><OCsTab /></TabsContent>
      </Tabs>
    </div>
  );
}