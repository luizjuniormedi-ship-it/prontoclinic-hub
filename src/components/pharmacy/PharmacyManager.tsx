/**
 * PharmacyManager — UI para gestão de Farmácia e Materiais
 *
 * Tabs:
 *   - Medicamentos  : catálogo com busca, classe, badge controlado
 *   - Materiais     : catálogo de materiais hospitalares
 *   - Estoque       : lotes com badges de validade (FEFO)
 *   - Movimentações : timeline de entradas/saídas
 *   - Dispensação   : wizard para atender receita
 *   - Alertas       : vencidos, baixo estoque, próximos ao vencimento
 *
 * Acessibilidade: navegação por teclado, aria-labels, focus visível.
 * Performance: TanStack Query com cache e invalidação por mutação.
 *
 * Migration: 20260101000015_farmacia.sql
 * Service:  src/services/pharmacyService.ts
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Pill, Search, Package, AlertTriangle, FileText, Activity,
  Plus, TrendingDown, Calendar, Boxes, AlertCircle,
} from "lucide-react";
import { pharmacyService, type Medicamento, type Material, type EstoqueAtual } from "@/services/pharmacyService";
import { DispenseWizard } from "./DispenseWizard";

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function statusValidadeBadge(status: EstoqueAtual["status_validade"]) {
  switch (status) {
    case "VENCIDO":
      return <Badge variant="destructive">Vencido</Badge>;
    case "VENCE_30_DIAS":
      return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Vence em 30d</Badge>;
    case "VENCE_90_DIAS":
      return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Vence em 90d</Badge>;
    default:
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">OK</Badge>;
  }
}

function MedicamentoForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    cd_principio_ativo: "",
    cd_nome_comercial: "",
    ds_concentracao: "",
    ds_forma_farmaceutica: "COMPRIMIDO",
    cd_anvisa: "",
    tp_receita: "BRANCA" as "BRANCA" | "AZUL" | "AMARELA" | "VERMELHA" | "CONTROLE_ESPECIAL",
    cd_classe_terapeutica: "ANALGESICO",
    lg_generico: false,
    lg_controlado: false,
    vl_unitario: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => pharmacyService.medicamentos.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["medicamentos"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        create.mutate();
      }}
      className="space-y-3"
    >
      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="cd_principio_ativo">Princípio Ativo *</Label>
          <Input id="cd_principio_ativo" required value={form.cd_principio_ativo}
            onChange={(e) => setForm({ ...form, cd_principio_ativo: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="cd_nome_comercial">Nome Comercial</Label>
          <Input id="cd_nome_comercial" value={form.cd_nome_comercial}
            onChange={(e) => setForm({ ...form, cd_nome_comercial: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="ds_concentracao">Concentração</Label>
          <Input id="ds_concentracao" placeholder="500mg" value={form.ds_concentracao}
            onChange={(e) => setForm({ ...form, ds_concentracao: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="ds_forma_farmaceutica">Forma</Label>
          <Select value={form.ds_forma_farmaceutica}
            onValueChange={(v) => setForm({ ...form, ds_forma_farmaceutica: v })}>
            <SelectTrigger id="ds_forma_farmaceutica"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="COMPRIMIDO">Comprimido</SelectItem>
              <SelectItem value="CAPSULA">Cápsula</SelectItem>
              <SelectItem value="INJETAVEL">Injetável</SelectItem>
              <SelectItem value="XAROPE">Xarope</SelectItem>
              <SelectItem value="SUSPENSAO">Suspensão</SelectItem>
              <SelectItem value="GOTAS">Gotas</SelectItem>
              <SelectItem value="CREME">Creme</SelectItem>
              <SelectItem value="POMADA">Pomada</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="cd_classe_terapeutica">Classe Terapêutica</Label>
          <Select value={form.cd_classe_terapeutica}
            onValueChange={(v) => setForm({ ...form, cd_classe_terapeutica: v })}>
            <SelectTrigger id="cd_classe_terapeutica"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ANALGESICO">Analgésico</SelectItem>
              <SelectItem value="ANTIBIOTICO">Antibiótico</SelectItem>
              <SelectItem value="ANTI_HIPERTENSIVO">Anti-hipertensivo</SelectItem>
              <SelectItem value="ANTI_INFLAMATORIO">Anti-inflamatório</SelectItem>
              <SelectItem value="ANSIOLITICO">Ansiolítico</SelectItem>
              <SelectItem value="ANTIDEPRESSIVO">Antidepressivo</SelectItem>
              <SelectItem value="ANALGESICO_OPIOIDE">Analgésico Opióide</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="tp_receita">Tipo de Receita</Label>
          <Select value={form.tp_receita}
            onValueChange={(v) => setForm({ ...form, tp_receita: v as typeof form.tp_receita })}>
            <SelectTrigger id="tp_receita"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="BRANCA">Branca (comum)</SelectItem>
              <SelectItem value="AZUL">Azul (controlado)</SelectItem>
              <SelectItem value="AMARELA">Amarela (entorpecentes)</SelectItem>
              <SelectItem value="VERMELHA">Vermelha (antimicrobiano)</SelectItem>
              <SelectItem value="CONTROLE_ESPECIAL">Controle Especial</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="cd_anvisa">Registro ANVISA</Label>
          <Input id="cd_anvisa" value={form.cd_anvisa}
            onChange={(e) => setForm({ ...form, cd_anvisa: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="vl_unitario">Valor Unitário (R$)</Label>
          <Input id="vl_unitario" type="number" step="0.01" min="0"
            value={form.vl_unitario}
            onChange={(e) => setForm({ ...form, vl_unitario: Number(e.target.value) })} />
        </div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.lg_generico}
            onChange={(e) => setForm({ ...form, lg_generico: e.target.checked })} />
          Genérico
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.lg_controlado}
            onChange={(e) => setForm({ ...form, lg_controlado: e.target.checked })} />
          Controlado (Portaria 344)
        </label>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Salvando..." : "Cadastrar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function MedicamentoTab() {
  const [search, setSearch] = useState("");
  const [filterControlado, setFilterControlado] = useState<string>("ALL");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: medicamentos, isLoading } = useQuery({
    queryKey: ["medicamentos"],
    queryFn: () => pharmacyService.medicamentos.getAll({ ativo: true }),
  });

  const filtered = useMemo(() => {
    return (medicamentos ?? []).filter((m: Medicamento) => {
      if (search) {
        const s = search.toLowerCase();
        if (
          !m.cd_principio_ativo.toLowerCase().includes(s) &&
          !(m.cd_nome_comercial?.toLowerCase().includes(s))
        ) return false;
      }
      if (filterControlado === "SIM" && !m.lg_controlado) return false;
      if (filterControlado === "NAO" && m.lg_controlado) return false;
      return true;
    });
  }, [medicamentos, search, filterControlado]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Catálogo de Medicamentos</CardTitle>
            <CardDescription>Rename + CMED + Portaria 344/98</CardDescription>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" />Novo Medicamento</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Cadastrar Medicamento</DialogTitle>
                <DialogDescription>Adicione um novo medicamento ao catálogo.</DialogDescription>
              </DialogHeader>
              <MedicamentoForm onClose={() => setCreateOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por princípio ativo ou nome comercial"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              aria-label="Buscar medicamentos"
            />
          </div>
          <Select value={filterControlado} onValueChange={setFilterControlado}>
            <SelectTrigger className="w-48" aria-label="Filtrar por tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos</SelectItem>
              <SelectItem value="SIM">Apenas controlados</SelectItem>
              <SelectItem value="NAO">Não controlados</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Princípio Ativo</TableHead>
                  <TableHead>Nome Comercial</TableHead>
                  <TableHead>Concentração</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead>Classe</TableHead>
                  <TableHead>Receita</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.cd_principio_ativo}</TableCell>
                    <TableCell>{m.cd_nome_comercial ?? "—"}</TableCell>
                    <TableCell>{m.ds_concentracao ?? "—"}</TableCell>
                    <TableCell>{m.ds_forma_farmaceutica ?? "—"}</TableCell>
                    <TableCell>{m.cd_classe_terapeutica ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {m.lg_controlado && <Badge variant="destructive">Controlado</Badge>}
                        {m.lg_generico && <Badge variant="secondary">Genérico</Badge>}
                        {m.tp_receita && m.tp_receita !== "BRANCA" && (
                          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{m.tp_receita}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {m.vl_unitario ? fmtBRL(Number(m.vl_unitario)) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      Nenhum medicamento encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MaterialTab() {
  const [search, setSearch] = useState("");
  const { data: materiais, isLoading } = useQuery({
    queryKey: ["materiais"],
    queryFn: () => pharmacyService.materiais.getAll({ ativo: true }),
  });

  const filtered = useMemo(() => {
    return (materiais ?? []).filter((m: Material) => {
      if (!search) return true;
      return m.ds_nome.toLowerCase().includes(search.toLowerCase());
    });
  }, [materiais, search]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catálogo de Materiais</CardTitle>
        <CardDescription>Descartáveis, EPI, instrumental, escritório</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar material"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              aria-label="Buscar materiais"
            />
          </div>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Custo Médio</TableHead>
                  <TableHead className="text-right">Ponto Reposição</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.ds_nome}</TableCell>
                    <TableCell>{m.ds_categoria ?? "—"}</TableCell>
                    <TableCell>{m.ds_unidade}</TableCell>
                    <TableCell className="text-right">
                      {m.vl_custo_medio ? fmtBRL(Number(m.vl_custo_medio)) : "—"}
                    </TableCell>
                    <TableCell className="text-right">{m.ponto_reposicao ?? 0}</TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Nenhum material encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EstoqueTab() {
  const { data: estoque, isLoading } = useQuery({
    queryKey: ["estoque-atual"],
    queryFn: () => supabaseViewEstoque(),
  });
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const filtered = useMemo(() => {
    if (!estoque) return [];
    if (filterStatus === "ALL") return estoque;
    return estoque.filter((e) => e.status_validade === filterStatus);
  }, [estoque, filterStatus]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Estoque Atual (FEFO)</CardTitle>
            <CardDescription>
              Ordenado por validade — primeiro a vencer, primeiro a sair
            </CardDescription>
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-48" aria-label="Filtrar por status de validade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos</SelectItem>
              <SelectItem value="OK">OK (válidos)</SelectItem>
              <SelectItem value="VENCE_90_DIAS">Vence em 90 dias</SelectItem>
              <SelectItem value="VENCE_30_DIAS">Vence em 30 dias</SelectItem>
              <SelectItem value="VENCIDO">Vencidos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Qtde</TableHead>
                  <TableHead>Almoxarifado</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.cd_lote}>
                    <TableCell>
                      <div className="font-medium">{e.ds_produto}</div>
                      {e.cd_nome_comercial && (
                        <div className="text-xs text-muted-foreground">{e.cd_nome_comercial}</div>
                      )}
                      {e.ds_concentracao && (
                        <div className="text-xs text-muted-foreground">{e.ds_concentracao}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.cd_lote}</TableCell>
                    <TableCell>
                      {new Date(e.dt_validade).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{e.cd_produto_tipo}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{e.qt_atual}</TableCell>
                    <TableCell className="text-sm">{e.ds_almoxarifado ?? "—"}</TableCell>
                    <TableCell>{statusValidadeBadge(e.status_validade)}</TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      Nenhum item em estoque.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

async function supabaseViewEstoque(): Promise<EstoqueAtual[]> {
  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await supabase
    .from("v_estoque_atual")
    .select("*")
    .order("dt_validade", { ascending: true });
  if (error) throw new Error(`Erro: ${error.message}`);
  return (data ?? []) as EstoqueAtual[];
}

function MovimentacoesTab() {
  const { data: movs, isLoading } = useQuery({
    queryKey: ["movimentacoes"],
    queryFn: () => pharmacyService.movimentacoes.getAll({ limit: 100 }),
  });

  const tipoBadge = (tipo: string) => {
    const map: Record<string, string> = {
      ENTRADA: "bg-green-100 text-green-800",
      SAIDA: "bg-blue-100 text-blue-800",
      AJUSTE: "bg-yellow-100 text-yellow-800",
      TRANSFERENCIA: "bg-purple-100 text-purple-800",
      PERDA: "bg-red-100 text-red-800",
      VENCIMENTO: "bg-gray-100 text-gray-800",
    };
    return <Badge className={map[tipo] ?? "bg-gray-100"}>{tipo}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Movimentações de Estoque</CardTitle>
        <CardDescription>Últimas 100 movimentações</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Qtde</TableHead>
                  <TableHead className="text-right">Anterior</TableHead>
                  <TableHead className="text-right">Posterior</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(movs ?? []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      {new Date(m.dt_movimentacao).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>{tipoBadge(m.tp_movimentacao)}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {m.tp_movimentacao === "ENTRADA" || m.tp_movimentacao === "AJUSTE" ? "+" : "−"}
                      {m.qt_movimentada}
                    </TableCell>
                    <TableCell className="text-right">{m.qt_anterior}</TableCell>
                    <TableCell className="text-right font-semibold">{m.qt_posterior}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.ds_motivo ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(movs ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Nenhuma movimentação registrada.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DispensacaoTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dispensação de Receita</CardTitle>
        <CardDescription>
          Wizard para atender uma receita — busca paciente, seleciona medicamentos (FEFO) e confirma.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DispenseWizard />
      </CardContent>
    </Card>
  );
}

function AlertasTab() {
  const { data: vencidos } = useQuery({
    queryKey: ["alertas-vencidos"],
    queryFn: () => pharmacyService.reports.getVencidos(),
  });
  const { data: proximos } = useQuery({
    queryKey: ["alertas-proximos"],
    queryFn: () => pharmacyService.lotes.getProximosVencimento(30),
  });
  const { data: baixoEstoque } = useQuery({
    queryKey: ["alertas-baixo-estoque"],
    queryFn: () => pharmacyService.reports.getEstoqueBaixo(),
  });
  const { data: valorEstoque } = useQuery({
    queryKey: ["valor-estoque"],
    queryFn: () => pharmacyService.reports.getValorEstoque(),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Valor Total em Estoque</CardDescription>
            <CardTitle className="text-2xl">
              {valorEstoque !== undefined ? fmtBRL(valorEstoque) : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Vencidos</CardDescription>
            <CardTitle className="text-2xl text-destructive">
              {vencidos?.length ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Vence em 30 dias</CardDescription>
            <CardTitle className="text-2xl text-amber-600">
              {proximos?.filter((p) => p.status_validade === "VENCE_30_DIAS").length ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Produtos Vencidos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(vencidos ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum produto vencido.</p>
          ) : (
            <ul className="space-y-1">
              {(vencidos ?? []).slice(0, 10).map((v) => (
                <li key={v.cd_lote} className="flex justify-between border-b py-1 text-sm">
                  <span><strong>{v.ds_produto}</strong> — lote {v.cd_lote}</span>
                  <span className="text-destructive">
                    {new Date(v.dt_validade).toLocaleDateString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-amber-600" />
            Estoque Abaixo do Ponto de Reposição
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(baixoEstoque ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Todos os materiais acima do mínimo.</p>
          ) : (
            <ul className="space-y-1">
              {(baixoEstoque ?? []).slice(0, 10).map((b) => (
                <li key={b.id} className="flex justify-between border-b py-1 text-sm">
                  <span><strong>{b.descricao}</strong></span>
                  <span className="text-amber-600">
                    {b.qt_atual} / mín. {b.ponto_reposicao}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function PharmacyManager() {
  return (
    <div className="space-y-4 p-2 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Pill className="h-6 w-6" />
            Farmácia e Materiais
          </h1>
          <p className="text-sm text-muted-foreground">
            Catálogo, estoque, lotes, dispensação e alertas
          </p>
        </div>
      </div>

      <Tabs defaultValue="medicamentos" className="w-full">
        <TabsList className="grid w-full grid-cols-3 md:grid-cols-6" aria-label="Seções da farmácia">
          <TabsTrigger value="medicamentos">
            <Pill className="mr-1 h-4 w-4" />Medicamentos
          </TabsTrigger>
          <TabsTrigger value="materiais">
            <Package className="mr-1 h-4 w-4" />Materiais
          </TabsTrigger>
          <TabsTrigger value="estoque">
            <Boxes className="mr-1 h-4 w-4" />Estoque
          </TabsTrigger>
          <TabsTrigger value="movimentacoes">
            <Activity className="mr-1 h-4 w-4" />Movimentações
          </TabsTrigger>
          <TabsTrigger value="dispensacao">
            <FileText className="mr-1 h-4 w-4" />Dispensar
          </TabsTrigger>
          <TabsTrigger value="alertas">
            <AlertTriangle className="mr-1 h-4 w-4" />Alertas
          </TabsTrigger>
        </TabsList>
        <TabsContent value="medicamentos"><MedicamentoTab /></TabsContent>
        <TabsContent value="materiais"><MaterialTab /></TabsContent>
        <TabsContent value="estoque"><EstoqueTab /></TabsContent>
        <TabsContent value="movimentacoes"><MovimentacoesTab /></TabsContent>
        <TabsContent value="dispensacao"><DispensacaoTab /></TabsContent>
        <TabsContent value="alertas"><AlertasTab /></TabsContent>
      </Tabs>
    </div>
  );
}
