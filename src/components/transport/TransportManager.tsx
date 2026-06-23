/**
 * TransportManager — UI principal do módulo de Remoção e Transporte Sanitário.
 *
 * Três abas:
 *   - Veículos: cadastro de veículos (placa, tipo, capacidade)
 *   - Equipe: cadastro de motoristas, técnicos e médicos
 *   - Remoções: lista filtrável de solicitações com status visual
 *
 * Decisões:
 *   - Status e urgência têm cores semafóricas para fácil leitura.
 *   - Remoções permitem iniciar/finalizar com KM para controle de quilometragem.
 *   - Alerta de CNH vencendo (30 dias) é mostrado no header da aba Equipe.
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
import { Plus, Truck, Users, Ambulance, AlertTriangle, Loader2, Play, Square, X } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
  veiculosService,
  equipeService,
  remocoesService,
  type Veiculo,
  type Equipe,
  type Remocao,
} from "@/services/transportService";

const URGENCIA_COLOR: Record<string, string> = {
  BAIXA: "bg-gray-100 text-gray-700",
  MEDIA: "bg-blue-100 text-blue-900",
  ALTA: "bg-amber-100 text-amber-900",
  EMERGENCIA: "bg-red-100 text-red-900",
};

const STATUS_REMOVAO_COLOR: Record<string, string> = {
  PENDENTE: "bg-gray-100 text-gray-700",
  AGENDADA: "bg-blue-100 text-blue-900",
  EM_ANDAMENTO: "bg-amber-100 text-amber-900",
  CONCLUIDA: "bg-green-100 text-green-900",
  CANCELADA: "bg-red-100 text-red-900",
};

function VeiculosTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    nr_placa: "",
    ds_modelo: "",
    nr_ano: new Date().getFullYear(),
    ds_tipo: "AMBULANCIA_SIMPLES" as Veiculo["ds_tipo"],
    nr_capacidade: 4,
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: veiculos, isLoading } = useQuery({
    queryKey: ["veiculos"],
    queryFn: () => veiculosService.getAll(),
  });

  const criarMut = useMutation({
    mutationFn: veiculosService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["veiculos"] });
      setIsOpen(false);
      setForm({ nr_placa: "", ds_modelo: "", nr_ano: new Date().getFullYear(), ds_tipo: "AMBULANCIA_SIMPLES", nr_capacidade: 4 });
      toast({ title: "Veículo cadastrado" });
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" />Veículos</CardTitle>
            <CardDescription>Frota de ambulâncias e veículos de transporte.</CardDescription>
          </div>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo Veículo</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo Veículo</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  criarMut.mutate({
                    nr_placa: form.nr_placa.toUpperCase(),
                    ds_modelo: form.ds_modelo || null,
                    nr_ano: form.nr_ano,
                    ds_tipo: form.ds_tipo,
                    nr_capacidade: form.nr_capacidade,
                    lg_ativo: true,
                  });
                }}
                className="space-y-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Placa *</Label>
                    <Input required value={form.nr_placa} onChange={(e) => setForm({ ...form, nr_placa: e.target.value })} placeholder="ABC1D23" />
                  </div>
                  <div>
                    <Label>Modelo</Label>
                    <Input value={form.ds_modelo} onChange={(e) => setForm({ ...form, ds_modelo: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Ano</Label>
                    <Input type="number" min={1900} value={form.nr_ano} onChange={(e) => setForm({ ...form, nr_ano: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label>Capacidade</Label>
                    <Input type="number" min={0} value={form.nr_capacidade} onChange={(e) => setForm({ ...form, nr_capacidade: Number(e.target.value) })} />
                  </div>
                </div>
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.ds_tipo ?? undefined} onValueChange={(v) => setForm({ ...form, ds_tipo: v as Veiculo["ds_tipo"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AMBULANCIA_SIMPLES">Ambulância Simples</SelectItem>
                      <SelectItem value="AMBULANCIA_UTI">Ambulância UTI</SelectItem>
                      <SelectItem value="TRANSPORTE_SIMPLES">Transporte Simples</SelectItem>
                      <SelectItem value="TRANSPORTE_ADAPTADO">Transporte Adaptado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={criarMut.isPending}>
                    {criarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Cadastrar
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Placa</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Ano</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Capacidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(veiculos ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground p-6">Nenhum veículo cadastrado.</TableCell></TableRow>
              ) : (
                (veiculos ?? []).map((v: Veiculo) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono">{v.nr_placa}</TableCell>
                    <TableCell>{v.ds_modelo ?? "—"}</TableCell>
                    <TableCell>{v.nr_ano ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{v.ds_tipo ?? "—"}</Badge></TableCell>
                    <TableCell>{v.nr_capacidade ?? "—"}</TableCell>
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

function EquipeTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    nm_nome: "",
    cd_cpf: "",
    tp_funcao: "MOTORISTA" as Equipe["tp_funcao"],
    nr_cnh: "",
    cd_categoria_cnh: "D",
    dt_validade_cnh: "",
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: equipe, isLoading } = useQuery({
    queryKey: ["equipe-transporte"],
    queryFn: () => equipeService.getAll(),
  });

  const { data: cnhVencendo } = useQuery({
    queryKey: ["cnh-vencendo"],
    queryFn: () => equipeService.getCNHVencendo(30),
  });

  const criarMut = useMutation({
    mutationFn: equipeService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipe-transporte"] });
      queryClient.invalidateQueries({ queryKey: ["cnh-vencendo"] });
      setIsOpen(false);
      setForm({ nm_nome: "", cd_cpf: "", tp_funcao: "MOTORISTA", nr_cnh: "", cd_categoria_cnh: "D", dt_validade_cnh: "" });
      toast({ title: "Membro cadastrado" });
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Equipe</CardTitle>
            <CardDescription>Motoristas, técnicos de enfermagem e médicos.</CardDescription>
          </div>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo Membro</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo Membro da Equipe</DialogTitle></DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  criarMut.mutate({
                    nm_nome: form.nm_nome,
                    cd_cpf: form.cd_cpf || null,
                    tp_funcao: form.tp_funcao,
                    nr_cnh: form.tp_funcao === "MOTORISTA" ? form.nr_cnh : null,
                    cd_categoria_cnh: form.tp_funcao === "MOTORISTA" ? form.cd_categoria_cnh : null,
                    dt_validade_cnh: form.tp_funcao === "MOTORISTA" ? form.dt_validade_cnh || null : null,
                    lg_ativo: true,
                  });
                }}
                className="space-y-3"
              >
                <div>
                  <Label>Nome *</Label>
                  <Input required value={form.nm_nome} onChange={(e) => setForm({ ...form, nm_nome: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>CPF</Label>
                    <Input maxLength={11} value={form.cd_cpf} onChange={(e) => setForm({ ...form, cd_cpf: e.target.value.replace(/\D/g, "") })} />
                  </div>
                  <div>
                    <Label>Função</Label>
                    <Select value={form.tp_funcao} onValueChange={(v) => setForm({ ...form, tp_funcao: v as Equipe["tp_funcao"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MOTORISTA">Motorista</SelectItem>
                        <SelectItem value="TECNICO_ENFERMAGEM">Técnico de Enfermagem</SelectItem>
                        <SelectItem value="MEDICO">Médico</SelectItem>
                        <SelectItem value="AUXILIAR">Auxiliar</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {form.tp_funcao === "MOTORISTA" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>CNH</Label>
                        <Input value={form.nr_cnh} onChange={(e) => setForm({ ...form, nr_cnh: e.target.value })} />
                      </div>
                      <div>
                        <Label>Categoria</Label>
                        <Select value={form.cd_categoria_cnh} onValueChange={(v) => setForm({ ...form, cd_categoria_cnh: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="A">A</SelectItem>
                            <SelectItem value="B">B</SelectItem>
                            <SelectItem value="C">C</SelectItem>
                            <SelectItem value="D">D</SelectItem>
                            <SelectItem value="E">E</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>Validade CNH</Label>
                      <Input type="date" value={form.dt_validade_cnh} onChange={(e) => setForm({ ...form, dt_validade_cnh: e.target.value })} />
                    </div>
                  </>
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={criarMut.isPending}>Cadastrar</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {(cnhVencendo?.length ?? 0) > 0 && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm text-amber-900">
              <strong>{cnhVencendo?.length}</strong> CNH(s) vencendo nos próximos 30 dias: {cnhVencendo?.map((c) => c.nm_nome).join(", ")}
            </span>
          </div>
        )}
        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>CPF</TableHead>
                <TableHead>CNH</TableHead>
                <TableHead>Validade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(equipe ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground p-6">Nenhum membro cadastrado.</TableCell></TableRow>
              ) : (
                (equipe ?? []).map((m: Equipe) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.nm_nome}</TableCell>
                    <TableCell><Badge variant="outline">{m.tp_funcao}</Badge></TableCell>
                    <TableCell>{m.cd_cpf ? m.cd_cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : "—"}</TableCell>
                    <TableCell>{m.nr_cnh ?? "—"}</TableCell>
                    <TableCell>{m.dt_validade_cnh ? new Date(m.dt_validade_cnh).toLocaleDateString("pt-BR") : "—"}</TableCell>
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

function RemocoesTab() {
  const [statusFiltro, setStatusFiltro] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    tp_tipo: "REMOCAO_SIMPLES" as Remocao["tp_tipo"],
    tp_urgencia: "MEDIA" as Remocao["tp_urgencia"],
    ds_origem: "",
    ds_destino: "",
    ds_justificativa: "",
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: remocoes, isLoading } = useQuery({
    queryKey: ["remocoes", statusFiltro],
    queryFn: () => remocoesService.getAll({ status: statusFiltro && statusFiltro !== "ALL" ? statusFiltro as Remocao["tp_status"] : undefined }),
  });

  const criarMut = useMutation({
    mutationFn: remocoesService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["remocoes"] });
      setIsOpen(false);
      setForm({ tp_tipo: "REMOCAO_SIMPLES", tp_urgencia: "MEDIA", ds_origem: "", ds_destino: "", ds_justificativa: "" });
      toast({ title: "Remoção solicitada" });
    },
    onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const iniciarMut = useMutation({
    mutationFn: ({ id, km }: { id: number; km: number }) => remocoesService.iniciar(id, km),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["remocoes"] });
      toast({ title: "Remoção iniciada" });
    },
  });

  const finalizarMut = useMutation({
    mutationFn: ({ id, km }: { id: number; km: number }) => remocoesService.finalizar(id, km),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["remocoes"] });
      toast({ title: "Remoção concluída" });
    },
  });

  const cancelarMut = useMutation({
    mutationFn: ({ id, motivo }: { id: number; motivo: string }) => remocoesService.cancelar(id, motivo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["remocoes"] });
      toast({ title: "Remoção cancelada" });
    },
  });

  const filtered = useMemo(() => {
    return (remocoes ?? []).filter((r) => {
      if (!statusFiltro || statusFiltro === "ALL") return true;
      return r.tp_status === statusFiltro;
    });
  }, [remocoes, statusFiltro]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Ambulance className="h-5 w-5" />Remoções e Transferências</CardTitle>
            <CardDescription>Solicitações de remoção e transporte sanitário.</CardDescription>
          </div>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Nova Remoção</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Solicitar Remoção</DialogTitle></DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  criarMut.mutate({
                    ...form,
                    cd_paciente: null,
                    tp_status: "PENDENTE",
                  });
                }}
                className="space-y-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Tipo</Label>
                    <Select value={form.tp_tipo} onValueChange={(v) => setForm({ ...form, tp_tipo: v as Remocao["tp_tipo"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="REMOCAO_SIMPLES">Remoção Simples</SelectItem>
                        <SelectItem value="REMOCAO_UTI">Remoção UTI</SelectItem>
                        <SelectItem value="TRANSFERENCIA_HOSPITALAR">Transferência Hospitalar</SelectItem>
                        <SelectItem value="ALTA_HOSPITALAR">Alta Hospitalar</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Urgência</Label>
                    <Select value={form.tp_urgencia} onValueChange={(v) => setForm({ ...form, tp_urgencia: v as Remocao["tp_urgencia"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BAIXA">Baixa</SelectItem>
                        <SelectItem value="MEDIA">Média</SelectItem>
                        <SelectItem value="ALTA">Alta</SelectItem>
                        <SelectItem value="EMERGENCIA">Emergência</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Origem *</Label>
                  <Textarea required value={form.ds_origem} onChange={(e) => setForm({ ...form, ds_origem: e.target.value })} />
                </div>
                <div>
                  <Label>Destino *</Label>
                  <Textarea required value={form.ds_destino} onChange={(e) => setForm({ ...form, ds_destino: e.target.value })} />
                </div>
                <div>
                  <Label>Justificativa</Label>
                  <Textarea value={form.ds_justificativa} onChange={(e) => setForm({ ...form, ds_justificativa: e.target.value })} />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={criarMut.isPending}>Solicitar</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <Select value={statusFiltro} onValueChange={setStatusFiltro}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Todos os status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos</SelectItem>
              <SelectItem value="PENDENTE">Pendente</SelectItem>
              <SelectItem value="AGENDADA">Agendada</SelectItem>
              <SelectItem value="EM_ANDAMENTO">Em Andamento</SelectItem>
              <SelectItem value="CONCLUIDA">Concluída</SelectItem>
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
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Urgência</TableHead>
                <TableHead>Origem → Destino</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground p-6">Nenhuma remoção encontrada.</TableCell></TableRow>
              ) : (
                filtered.map((r: Remocao) => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.dt_solicitacao).toLocaleString("pt-BR")}</TableCell>
                    <TableCell><Badge variant="outline">{r.tp_tipo}</Badge></TableCell>
                    <TableCell><Badge className={URGENCIA_COLOR[r.tp_urgencia]} variant="outline">{r.tp_urgencia}</Badge></TableCell>
                    <TableCell className="text-sm">
                      <div className="truncate max-w-xs">{r.ds_origem} → {r.ds_destino}</div>
                    </TableCell>
                    <TableCell><Badge className={STATUS_REMOVAO_COLOR[r.tp_status]} variant="outline">{r.tp_status}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {(r.tp_status === "PENDENTE" || r.tp_status === "AGENDADA") && (
                          <Button size="sm" variant="outline" onClick={() => {
                            const km = prompt("Quilometragem inicial:");
                            if (km) iniciarMut.mutate({ id: r.id, km: Number(km) });
                          }}><Play className="h-3 w-3" /></Button>
                        )}
                        {r.tp_status === "EM_ANDAMENTO" && (
                          <Button size="sm" variant="outline" onClick={() => {
                            const km = prompt("Quilometragem final:");
                            if (km) finalizarMut.mutate({ id: r.id, km: Number(km) });
                          }}><Square className="h-3 w-3" /></Button>
                        )}
                        {r.tp_status !== "CONCLUIDA" && r.tp_status !== "CANCELADA" && (
                          <Button size="sm" variant="ghost" onClick={() => {
                            const motivo = prompt("Motivo do cancelamento:");
                            if (motivo) cancelarMut.mutate({ id: r.id, motivo });
                          }}><X className="h-3 w-3 text-red-500" /></Button>
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
    </Card>
  );
}

export function TransportManager() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="veiculos">
        <TabsList>
          <TabsTrigger value="veiculos">Veículos</TabsTrigger>
          <TabsTrigger value="equipe">Equipe</TabsTrigger>
          <TabsTrigger value="remocoes">Remoções</TabsTrigger>
        </TabsList>
        <TabsContent value="veiculos"><VeiculosTab /></TabsContent>
        <TabsContent value="equipe"><EquipeTab /></TabsContent>
        <TabsContent value="remocoes"><RemocoesTab /></TabsContent>
      </Tabs>
    </div>
  );
}