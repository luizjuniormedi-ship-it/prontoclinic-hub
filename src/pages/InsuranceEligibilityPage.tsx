import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { History, Plus, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { insuranceEligibilityService, type EligibilityStatus } from "@/services/insuranceEligibilityService";

const statuses: EligibilityStatus[] = ["pendente", "em_analise", "elegivel", "nao_elegivel", "portal_indisponivel", "nao_obrigatoria", "liberado_excecao"];

export default function InsuranceEligibilityPage() {
  const { companyId } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({ patient_id: "", appointment_id: "", insurance_plan_id: "", card_number: "", protocol_number: "", valid_until: "" });
  const { data = [], isLoading } = useQuery({ queryKey: ["insurance-eligibility"], queryFn: () => insuranceEligibilityService.list() });
  const { data: history = [] } = useQuery({ queryKey: ["insurance-eligibility-history", selectedId], queryFn: () => insuranceEligibilityService.history(selectedId as string), enabled: !!selectedId });
  const create = useMutation({
    mutationFn: () => insuranceEligibilityService.create({ company_id: companyId ?? "", patient_id: Number(form.patient_id) || null, appointment_id: Number(form.appointment_id) || null, insurance_plan_id: Number(form.insurance_plan_id) || null, card_number: form.card_number || null, protocol_number: form.protocol_number || null, valid_until: form.valid_until || null, status: "pendente", source: "manual" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["insurance-eligibility"] }); setForm({ patient_id: "", appointment_id: "", insurance_plan_id: "", card_number: "", protocol_number: "", valid_until: "" }); },
  });
  const update = useMutation({ mutationFn: ({ id, status }: { id: string; status: EligibilityStatus }) => insuranceEligibilityService.update(id, { status, checked_at: status === "pendente" ? null : new Date().toISOString() }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["insurance-eligibility"] }) });

  return <div className="space-y-5 p-4 md:p-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">Elegibilidade</h1><p className="text-sm text-muted-foreground">Consulta manual, portal/API, validade, comprovante, exceção e histórico por empresa.</p></div><Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["insurance-eligibility"] })}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" />Nova consulta manual</CardTitle></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-3">
      <div><Label>Paciente ID</Label><Input type="number" value={form.patient_id} onChange={(e) => setForm({ ...form, patient_id: e.target.value })} /></div>
      <div><Label>Agendamento ID</Label><Input type="number" value={form.appointment_id} onChange={(e) => setForm({ ...form, appointment_id: e.target.value })} /></div>
      <div><Label>Plano ID</Label><Input type="number" value={form.insurance_plan_id} onChange={(e) => setForm({ ...form, insurance_plan_id: e.target.value })} /></div>
      <div><Label>Carteirinha</Label><Input value={form.card_number} onChange={(e) => setForm({ ...form, card_number: e.target.value })} /></div>
      <div><Label>Protocolo</Label><Input value={form.protocol_number} onChange={(e) => setForm({ ...form, protocol_number: e.target.value })} /></div>
      <div><Label>Válida até</Label><Input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></div>
    </div><Button className="mt-4" onClick={() => create.mutate()} disabled={create.isPending || !companyId}>Registrar consulta</Button></CardContent></Card>
    <Card><CardHeader><CardTitle>Histórico de consultas</CardTitle></CardHeader><CardContent>{isLoading ? <p>Carregando...</p> : <Table><TableHeader><TableRow><TableHead>Status</TableHead><TableHead>Paciente</TableHead><TableHead>Agendamento</TableHead><TableHead>Protocolo</TableHead><TableHead>Validade</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader><TableBody>{data.map((item) => <TableRow key={item.id}><TableCell><Badge variant={item.status === "elegivel" ? "default" : "outline"}>{item.status}</Badge></TableCell><TableCell>{item.patient_id ?? "-"}</TableCell><TableCell>{item.appointment_id ?? "-"}</TableCell><TableCell>{item.protocol_number ?? "-"}</TableCell><TableCell>{item.valid_until ?? "-"}</TableCell><TableCell><div className="flex gap-2"><Select value={item.status} onValueChange={(value) => update.mutate({ id: item.id, status: value as EligibilityStatus })}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>{statuses.map((status) => <SelectItem key={status} value={status}>{status.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select><Button size="icon" variant="outline" title="Ver histórico" onClick={() => setSelectedId(item.id)}><History className="h-4 w-4" /></Button></div></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
    {selectedId && <Card><CardHeader><CardTitle>Histórico da consulta</CardTitle></CardHeader><CardContent>{history.length ? history.map((entry) => <div key={entry.id} className="border-b py-2 text-sm"><strong>{entry.old_status ?? "novo"} → {entry.new_status}</strong><span className="ml-2 text-muted-foreground">{new Date(entry.created_at).toLocaleString("pt-BR")}</span><p>{entry.result_detail || entry.protocol_number || "Sem detalhe"}</p></div>) : <p className="text-sm text-muted-foreground">Nenhum histórico registrado.</p>}</CardContent></Card>}
  </div>;
}
