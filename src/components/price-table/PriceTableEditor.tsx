/**
 * PriceTableEditor — Editor de Tabela de Precos
 *
 * Substitui priceTableService mock por versao completa.
 * CRUD de regras de preco: Tipo Atendimento x Convenio x Servico.
 * Usa funcao SQL `find_price()` para resolver com fallback.
 *
 * Migration: 20260101000005_price_tables.sql
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Calculator } from "lucide-react";
import { priceTableService, type PriceTable } from "@/services/priceTableService";
import { insuranceCompanyService } from "@/services/insuranceService";
import { supabase } from "@/lib/supabase";

export function PriceTableEditor() {
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [testServiceId, setTestServiceId] = useState<number | null>(null);
  const [testPlanId, setTestPlanId] = useState<number | null>(null);
  const [lookupResult, setLookupResult] = useState<any>(null);
  const queryClient = useQueryClient();

  const { data: prices, isLoading } = useQuery({
    queryKey: ["price-tables"],
    queryFn: () => priceTableService.getAll(),
  });

  const { data: insurances } = useQuery({
    queryKey: ["insurance-companies"],
    queryFn: () => insuranceCompanyService.getAll(),
  });

  const { data: services } = useQuery({
    queryKey: ["services-catalog"],
    queryFn: async () => {
      const { data } = await supabase
        .from("services_catalog")
        .select("id, name, price")
        .order("name")
        .limit(200);
      return data || [];
    },
  });

  const { data: appointmentTypes } = useQuery({
    queryKey: ["appointment-types"],
    queryFn: async () => {
      const { data } = await supabase
        .from("appointment_types")
        .select("id, name")
        .order("name");
      return data || [];
    },
  });

  const createPrice = useMutation({
    mutationFn: priceTableService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-tables"] });
      setIsCreateOpen(false);
    },
  });

  const testLookup = async () => {
    if (!testServiceId || !appointmentTypes?.[0]?.id) return;
    const result = await priceTableService.findPrice(
      testServiceId,
      appointmentTypes[0].id,
      testPlanId
    );
    setLookupResult(result);
  };

  const filtered = (prices || []).filter(
    (p) =>
      !search ||
      p.description?.toLowerCase().includes(search.toLowerCase()) ||
      String(p.service_id).includes(search)
  );

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tabela de Precos</h1>
          <p className="text-muted-foreground">Regras de preco por Tipo de Atendimento x Convenio x Servico</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Nova Regra</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Regra de Preco</DialogTitle>
              <DialogDescription>Se Convenio = "Particular", o preco e usado como base.</DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const planId = f.get("insurance_plan_id") as string;
                createPrice.mutate({
                  service_id: Number(f.get("service_id")),
                  appointment_type_id: Number(f.get("appointment_type_id")),
                  insurance_plan_id: planId === "particular" ? null : Number(planId),
                  vl_particular: Number(f.get("vl_particular") || 0),
                  vl_convenio: Number(f.get("vl_convenio") || 0),
                  vl_material: Number(f.get("vl_material") || 0),
                  vl_medicamento: Number(f.get("vl_medicamento") || 0),
                  vl_taxa: Number(f.get("vl_taxa") || 0),
                  dt_inicio: (f.get("dt_inicio") as string) || new Date().toISOString().split("T")[0],
                  active: true,
                } as Partial<PriceTable>);
              }}
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Servico *</Label>
                  <Select name="service_id" required>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {(services || []).map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tipo Atendimento *</Label>
                  <Select name="appointment_type_id" required>
                    <SelectTrigger><SelectValue placeholder="..." /></SelectTrigger>
                    <SelectContent>
                      {(appointmentTypes || []).map((t: any) => (
                        <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Convenio</Label>
                  <Select name="insurance_plan_id" defaultValue="particular">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="particular">— Particular (sem convenio) —</SelectItem>
                      {(insurances || []).map((ins) => (
                        <SelectItem key={ins.id} value={String(ins.id)}>{ins.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Particular (R$)</Label><Input name="vl_particular" type="number" step="0.01" /></div>
                <div><Label>Convenio (R$)</Label><Input name="vl_convenio" type="number" step="0.01" /></div>
                <div><Label>Material (R$)</Label><Input name="vl_material" type="number" step="0.01" /></div>
                <div><Label>Medicamento (R$)</Label><Input name="vl_medicamento" type="number" step="0.01" /></div>
                <div><Label>Taxa (R$)</Label><Input name="vl_taxa" type="number" step="0.01" /></div>
                <div>
                  <Label>Vigencia desde</Label>
                  <Input name="dt_inicio" type="date" defaultValue={new Date().toISOString().split("T")[0]} />
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createPrice.isPending}>
                  {createPrice.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />Testar busca de preco
          </CardTitle>
          <CardDescription>Simula a funcao SQL <code>find_price()</code> com fallback</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label>Servico</Label>
              <Select onValueChange={(v) => setTestServiceId(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {(services || []).map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label>Convenio (opcional)</Label>
              <Select onValueChange={(v) => setTestPlanId(v === "particular" ? null : Number(v))}>
                <SelectTrigger><SelectValue placeholder="Particular" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="particular">— Particular —</SelectItem>
                  {(insurances || []).map((i) => (
                    <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={testLookup}>Buscar</Button>
          </div>
          {lookupResult && (
            <pre className="mt-4 p-4 bg-muted rounded text-sm">
              {JSON.stringify(lookupResult, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Servico</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Convenio</TableHead>
                <TableHead className="text-right">Particular</TableHead>
                <TableHead className="text-right">Convenio</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Medicamento</TableHead>
                <TableHead>Taxa</TableHead>
                <TableHead>Vigencia</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Nenhuma regra. Crie a primeira.</TableCell></TableRow>
              ) : (
                filtered.slice(0, 50).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.service?.name || `Servico #${p.service_id}`}</TableCell>
                    <TableCell>{p.appointment_type?.name || "—"}</TableCell>
                    <TableCell>{p.plan ? p.plan.name : <Badge variant="secondary">Particular</Badge>}</TableCell>
                    <TableCell className="text-right">R$ {p.vl_particular.toFixed(2)}</TableCell>
                    <TableCell className="text-right">R$ {p.vl_convenio.toFixed(2)}</TableCell>
                    <TableCell>R$ {p.vl_material.toFixed(2)}</TableCell>
                    <TableCell>R$ {p.vl_medicamento.toFixed(2)}</TableCell>
                    <TableCell>R$ {p.vl_taxa.toFixed(2)}</TableCell>
                    <TableCell>{p.dt_inicio}</TableCell>
                    <TableCell><Badge variant={p.active ? "default" : "secondary"}>{p.active ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}