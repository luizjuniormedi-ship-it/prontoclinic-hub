/**
 * InsuranceManager — UI para gestao de Convenios, Planos e Fonte Pagadora
 *
 * Substitui a versao mockada do api.ts e CompaniesPage.tsx.
 * Usa insuranceService (insuranceCompanyService, insurancePlanService, paymentSourceService)
 *
 * Migrations: 000001, 000002, 000003
 */

import { useState } from "react";
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
import { Plus, Search } from "lucide-react";
import {
  insuranceCompanyService,
  insurancePlanService,
  paymentSourceService,
  type InsuranceCompany,
  type PaymentSourceType,
} from "@/services/insuranceService";
import { InsuranceRow } from "./InsuranceRow";

export function InsuranceManager() {
  const [search, setSearch] = useState("");
  const [selectedInsurance, setSelectedInsurance] = useState<InsuranceCompany | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: insuranceCompanies, isLoading: loadingInsurances } = useQuery({
    queryKey: ["insurance-companies"],
    queryFn: () => insuranceCompanyService.getAll(),
  });

  const { data: paymentSources, isLoading: loadingPS } = useQuery({
    queryKey: ["payment-sources"],
    queryFn: () => paymentSourceService.getAll(),
  });

  const { data: plans } = useQuery({
    queryKey: ["insurance-plans", selectedInsurance?.id],
    queryFn: () =>
      selectedInsurance
        ? insurancePlanService.getByInsurance(selectedInsurance.id)
        : Promise.resolve([]),
    enabled: !!selectedInsurance,
  });

  const createInsurance = useMutation({
    mutationFn: insuranceCompanyService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-companies"] });
      setIsCreateOpen(false);
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      insuranceCompanyService.update(id, { lg_ativo: !ativo } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-companies"] });
    },
  });

  const filtered = (insuranceCompanies || []).filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const getPaymentSource = (id?: number) =>
    (paymentSources || []).find((ps) => ps.id === id);

  const typeBadge = (type: PaymentSourceType) => {
    const colors: Record<PaymentSourceType, string> = {
      SUS: "bg-blue-100 text-blue-800",
      PARTICULAR: "bg-green-100 text-green-800",
      CORTESIA: "bg-gray-100 text-gray-800",
      CONVENIO: "bg-purple-100 text-purple-800",
    };
    return <Badge className={colors[type]}>{type}</Badge>;
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Convenios e Planos</h1>
          <p className="text-muted-foreground">Gestao de convenios, planos, fonte pagadora e credenciamento</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Novo Convenio</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo Convenio</DialogTitle>
              <DialogDescription>Cadastre um novo convenio no sistema.</DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                createInsurance.mutate({
                  name: fd.get("name") as string,
                  registro_ans: (fd.get("registro_ans") as string) || undefined,
                  cnpj: (fd.get("cnpj") as string) || undefined,
                  payment_source_id: Number(fd.get("payment_source_id")) || undefined,
                  lg_ativo: true,
                } as Partial<InsuranceCompany>);
              }}
            >
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Nome do Convenio *</Label>
                  <Input id="name" name="name" required maxLength={100} />
                </div>
                <div>
                  <Label htmlFor="registro_ans">Registro ANS</Label>
                  <Input id="registro_ans" name="registro_ans" maxLength={20} />
                </div>
                <div>
                  <Label htmlFor="cnpj">CNPJ</Label>
                  <Input id="cnpj" name="cnpj" maxLength={14} />
                </div>
                <div>
                  <Label htmlFor="payment_source_id">Fonte Pagadora</Label>
                  <Select name="payment_source_id">
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {(paymentSources || []).map((ps) => (
                        <SelectItem key={ps.id} value={String(ps.id)}>{ps.name} ({ps.type})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createInsurance.isPending}>
                  {createInsurance.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="insurances" className="w-full">
        <TabsList>
          <TabsTrigger value="insurances">Convenios ({filtered.length})</TabsTrigger>
          <TabsTrigger value="sources">Fonte Pagadora ({paymentSources?.length || 0})</TabsTrigger>
          <TabsTrigger value="plans">Planos ({plans?.length || 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="insurances" className="space-y-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Registro ANS</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[100px]">Acoes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingInsurances ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8">Carregando...</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum convenio encontrado.</TableCell></TableRow>
                  ) : (
                    filtered.map((c) => {
                      const ps = getPaymentSource(c.payment_source_id);
                      return (
                        <InsuranceRow
                          key={c.id}
                          insurance={c}
                          paymentSource={ps}
                          onSelect={setSelectedInsurance}
                          onToggleActive={(id, ativo) =>
                            toggleActive.mutate({ id, ativo })
                          }
                        />
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sources">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>CNPJ</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPS ? (
                    <TableRow><TableCell colSpan={3} className="text-center py-8">Carregando...</TableCell></TableRow>
                  ) : (
                    (paymentSources || []).map((ps) => (
                      <TableRow key={ps.id}>
                        <TableCell className="font-medium">{ps.name}</TableCell>
                        <TableCell>{typeBadge(ps.type)}</TableCell>
                        <TableCell>{ps.cnpj || "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans">
          {!selectedInsurance ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Selecione um convenio na aba "Convenios" para ver seus planos.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Planos: {selectedInsurance.name}</CardTitle>
                <CardDescription>{plans?.length || 0} plano(s) cadastrado(s)</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Nome</TableHead><TableHead>Codigo</TableHead><TableHead>Coparticipacao</TableHead><TableHead>Acomodacao</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {(plans || []).map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>{p.codigo || "—"}</TableCell>
                        <TableCell>{p.lg_coparticipacao ? `${p.percentual_coparticipacao}%` : "Nao"}</TableCell>
                        <TableCell>{p.tipo_acomodacao || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}