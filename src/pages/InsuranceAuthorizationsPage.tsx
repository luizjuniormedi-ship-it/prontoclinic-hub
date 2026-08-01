import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, History, Paperclip, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  insuranceAuthorizationService,
  type AuthorizationStatus,
  type InsuranceAuthorization,
} from "@/services/insuranceAuthorizationService";

const statuses: AuthorizationStatus[] = [
  "pendente", "solicitada", "em_analise", "autorizada", "parcialmente_autorizada",
  "negada", "vencida", "cancelada", "reenviada", "liberada_excecao", "nao_necessaria",
];

const statusLabel: Record<AuthorizationStatus, string> = {
  pendente: "Pendente", solicitada: "Solicitada", em_analise: "Em análise", autorizada: "Autorizada",
  parcialmente_autorizada: "Parcial", negada: "Negada", vencida: "Vencida", cancelada: "Cancelada",
  reenviada: "Reenviada", liberada_excecao: "Exceção liberada", nao_necessaria: "Não necessária",
};

function Field({ label, name, type = "text", required = false, defaultValue, placeholder }: {
  label: string; name: string; type?: string; required?: boolean; defaultValue?: string | number; placeholder?: string;
}) {
  return <div className="space-y-1"><Label htmlFor={name}>{label}{required ? " *" : ""}</Label><Input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} /></div>;
}

export default function InsuranceAuthorizationsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AuthorizationStatus | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<InsuranceAuthorization | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [followupOpen, setFollowupOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["insurance-authorizations", status, search],
    queryFn: () => insuranceAuthorizationService.list({ status: status || undefined, search }),
  });
  const history = useQuery({
    queryKey: ["insurance-authorization-history", selected?.id],
    queryFn: () => selected ? insuranceAuthorizationService.listHistory(selected.id) : Promise.resolve([]),
    enabled: !!selected,
  });
  const attachments = useQuery({
    queryKey: ["insurance-authorization-attachments", selected?.id],
    queryFn: () => selected ? insuranceAuthorizationService.listAttachments(selected.id) : Promise.resolve([]),
    enabled: !!selected,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["insurance-authorizations"] });
    if (selected) {
      void queryClient.invalidateQueries({ queryKey: ["insurance-authorization-history", selected.id] });
      void queryClient.invalidateQueries({ queryKey: ["insurance-authorization-attachments", selected.id] });
    }
  };
  const create = useMutation({
    mutationFn: (input: Parameters<typeof insuranceAuthorizationService.create>[0]) => insuranceAuthorizationService.create(input),
    onSuccess: () => { setCreateOpen(false); invalidate(); toast({ title: "Solicitação criada e auditada" }); },
    onError: (error: Error) => toast({ title: "Não foi possível solicitar", description: error.message, variant: "destructive" }),
  });
  const transition = useMutation({
    mutationFn: (input: Parameters<typeof insuranceAuthorizationService.transition>[0]) => insuranceAuthorizationService.transition(input),
    onSuccess: (row) => { setSelected(row); setEditOpen(false); invalidate(); toast({ title: "Autorização atualizada e auditada" }); },
    onError: (error: Error) => toast({ title: "Transição rejeitada", description: error.message, variant: "destructive" }),
  });
  const followup = useMutation({
    mutationFn: (input: Parameters<typeof insuranceAuthorizationService.createFollowup>[0]) => insuranceAuthorizationService.createFollowup(input),
    onSuccess: () => { setFollowupOpen(false); invalidate(); toast({ title: "Renovação/prorrogação criada" }); },
    onError: (error: Error) => toast({ title: "Não foi possível criar seguimento", description: error.message, variant: "destructive" }),
  });
  const attachment = useMutation({
    mutationFn: (input: Parameters<typeof insuranceAuthorizationService.addAttachment>[0]) => insuranceAuthorizationService.addAttachment(input),
    onSuccess: () => { invalidate(); toast({ title: "Anexo registrado" }); },
    onError: (error: Error) => toast({ title: "Não foi possível registrar anexo", description: error.message, variant: "destructive" }),
  });

  const rows = useMemo(() => query.data || [], [query.data]);

  const submitCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({
      patientId: Number(form.get("patient_id")) || null,
      appointmentId: Number(form.get("appointment_id")) || null,
      insuranceId: Number(form.get("insurance_id")) || null,
      insurancePlanId: Number(form.get("insurance_plan_id")) || null,
      procedureId: Number(form.get("procedure_id")) || null,
      procedureCode: String(form.get("procedure_code") || "") || null,
      procedureDescription: String(form.get("procedure_description") || "") || null,
      requestReference: String(form.get("request_reference") || "") || null,
      requestedProfessionalId: Number(form.get("requested_professional_id")) || null,
      diagnosisCode: String(form.get("diagnosis_code") || "") || null,
      justification: String(form.get("justification") || "") || null,
      quantityRequested: Number(form.get("quantity_requested")) || 1,
      validFrom: String(form.get("valid_from") || "") || null,
      validUntil: String(form.get("valid_until") || "") || null,
    });
  };

  return <div className="space-y-5 p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Autorizações</h1><p className="text-muted-foreground">Solicitação, acompanhamento, negativa, renovação e histórico por tenant.</p></div>
      <Button onClick={() => setCreateOpen(true)}><FilePlus2 />Nova solicitação</Button>
    </div>
    <Card><CardContent className="flex flex-wrap items-center gap-3 p-4">
      <Search className="h-4 w-4 text-muted-foreground" /><Input className="max-w-sm" placeholder="Protocolo, pedido, autorização ou CID" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select aria-label="Filtrar status" className="h-10 rounded-md border bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value as AuthorizationStatus | "")}><option value="">Todos os status</option>{statuses.map((value) => <option key={value} value={value}>{statusLabel[value]}</option>)}</select>
      <Button variant="outline" size="icon" title="Atualizar" onClick={() => void query.refetch()}><RefreshCw /></Button>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Solicitações ({rows.length})</CardTitle><CardDescription>Senha não é exibida na listagem nem gravada no histórico.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Pedido</TableHead><TableHead>Paciente/agenda</TableHead><TableHead>Procedimento</TableHead><TableHead>Quantidade</TableHead><TableHead>Status</TableHead><TableHead>Validade</TableHead><TableHead /></TableRow></TableHeader><TableBody>
      {query.isLoading ? <TableRow><TableCell colSpan={7} className="py-8 text-center">Carregando...</TableCell></TableRow> : query.isError ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-destructive">{(query.error as Error).message}</TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhuma autorização encontrada.</TableCell></TableRow> : rows.map((row) => <TableRow key={row.id} onClick={() => setSelected(row)} className="cursor-pointer"><TableCell className="font-medium">{row.request_reference || "Sem referência"}<div className="text-xs text-muted-foreground">{row.protocol_number || "Sem protocolo"}</div></TableCell><TableCell>#{row.patient_id || "-"} / #{row.appointment_id || "-"}</TableCell><TableCell>{row.procedure_code || "-"}<div className="text-xs text-muted-foreground">{row.procedure_desc || "Sem descrição"}</div></TableCell><TableCell>{row.quantity_used}/{row.quantity_authorized}/{row.quantity_requested}</TableCell><TableCell><Badge variant={row.status === "negada" ? "destructive" : row.status === "autorizada" ? "default" : "secondary"}>{statusLabel[row.status]}</Badge></TableCell><TableCell>{row.valid_until || "-"}</TableCell><TableCell><Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); setSelected(row); setEditOpen(true); }}>Editar</Button></TableCell></TableRow>)}
    </TableBody></Table></CardContent></Card>

    {selected && <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Autorização {selected.request_reference || selected.id}</CardTitle><CardDescription>{selected.justification || "Sem justificativa registrada"}</CardDescription></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setEditOpen(true)}>Atualizar status</Button><Button variant="outline" onClick={() => setFollowupOpen(true)}><RefreshCw />Renovar/prorrogar</Button></div></div></CardHeader><CardContent className="grid gap-5 lg:grid-cols-2"><div><h3 className="mb-2 flex items-center gap-2 font-semibold"><History className="h-4 w-4" />Histórico</h3>{history.isLoading ? <p>Carregando...</p> : history.data?.length ? <div className="space-y-2">{history.data.map((event) => <div key={event.id} className="border-b pb-2 text-sm"><div className="flex justify-between gap-2"><strong>{event.event_type}</strong><span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString("pt-BR")}</span></div><div>{event.from_status || "-"} → {event.to_status || "-"}</div>{event.reason && <p className="text-muted-foreground">{event.reason}</p>}</div>)}</div> : <p className="text-sm text-muted-foreground">Nenhum evento.</p>}</div><div><h3 className="mb-2 flex items-center gap-2 font-semibold"><Paperclip className="h-4 w-4" />Anexos</h3>{attachments.data?.length ? <div className="mb-3 space-y-1">{attachments.data.map((file) => <div key={file.id} className="text-sm">{file.file_name} <span className="text-xs text-muted-foreground">({file.mime_type})</span></div>)}</div> : <p className="mb-3 text-sm text-muted-foreground">Nenhum anexo registrado.</p>}<form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); attachment.mutate({ authorizationId: selected.id, storagePath: String(form.get("storage_path") || ""), fileName: String(form.get("file_name") || ""), mimeType: String(form.get("mime_type") || "application/octet-stream"), fileSize: Number(form.get("file_size")) || null }); event.currentTarget.reset(); }}><Input name="file_name" required placeholder="Nome do arquivo" /><Input name="storage_path" required placeholder="Caminho no storage" /><Input name="mime_type" defaultValue="application/pdf" placeholder="MIME" /><Input name="file_size" type="number" min="0" placeholder="Tamanho em bytes" /><Button type="submit" variant="outline" disabled={attachment.isPending}>Registrar anexo</Button></form></div></CardContent></Card>}

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Nova solicitação de autorização</DialogTitle><DialogDescription>Os IDs referenciam registros já existentes; a empresa é derivada da sessão.</DialogDescription></DialogHeader><form onSubmit={submitCreate} className="grid gap-4"><div className="grid gap-3 md:grid-cols-3"><Field label="Paciente ID" name="patient_id" type="number" /><Field label="Agendamento ID" name="appointment_id" type="number" /><Field label="Convênio ID" name="insurance_id" type="number" /><Field label="Plano ID" name="insurance_plan_id" type="number" /><Field label="Profissional solicitante ID" name="requested_professional_id" type="number" /><Field label="Pedido/referência" name="request_reference" required /></div><div className="grid gap-3 md:grid-cols-2"><Field label="Código do procedimento" name="procedure_code" /><Field label="Descrição do procedimento" name="procedure_description" required /><Field label="Procedimento ID" name="procedure_id" type="number" /><Field label="CID" name="diagnosis_code" /></div><div className="grid gap-3 md:grid-cols-3"><Field label="Quantidade solicitada" name="quantity_requested" type="number" required defaultValue={1} /><Field label="Válida a partir de" name="valid_from" type="date" /><Field label="Válida até" name="valid_until" type="date" /></div><div className="space-y-1"><Label htmlFor="justification">Justificativa</Label><Textarea id="justification" name="justification" required /></div><DialogFooter><Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "Salvando..." : "Solicitar"}</Button></DialogFooter></form></DialogContent></Dialog>

    <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent><DialogHeader><DialogTitle>Atualizar autorização</DialogTitle><DialogDescription>A senha é enviada ao RPC e não aparece na listagem/histórico.</DialogDescription></DialogHeader>{selected && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); transition.mutate({ authorizationId: selected.id, status: String(form.get("status")) as AuthorizationStatus, protocolNumber: String(form.get("protocol_number") || "") || null, authorizationNumber: String(form.get("authorization_number") || "") || null, passwordNumber: String(form.get("password_number") || "") || null, validUntil: String(form.get("valid_until") || "") || null, quantityAuthorized: Number(form.get("quantity_authorized")) || 0, quantityUsed: Number(form.get("quantity_used")) || 0, reason: String(form.get("reason") || "") || null }); }} className="grid gap-4"><div className="space-y-1"><Label htmlFor="status">Status</Label><select id="status" name="status" className="h-10 w-full rounded-md border bg-background px-3 text-sm" defaultValue={selected.status}>{statuses.map((value) => <option key={value} value={value}>{statusLabel[value]}</option>)}</select></div><div className="grid gap-3 md:grid-cols-2"><Field label="Protocolo" name="protocol_number" defaultValue={selected.protocol_number || ""} /><Field label="Número da autorização" name="authorization_number" defaultValue={selected.authorization_number || ""} /><Field label="Senha" name="password_number" type="password" placeholder="Não exibida após salvar" /><Field label="Validade" name="valid_until" type="date" defaultValue={selected.valid_until || ""} /><Field label="Quantidade autorizada" name="quantity_authorized" type="number" defaultValue={selected.quantity_authorized} /><Field label="Quantidade utilizada" name="quantity_used" type="number" defaultValue={selected.quantity_used} /></div><div className="space-y-1"><Label htmlFor="reason">Motivo/observação</Label><Textarea id="reason" name="reason" /></div><DialogFooter><Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>Cancelar</Button><Button type="submit" disabled={transition.isPending}>{transition.isPending ? "Salvando..." : "Salvar"}</Button></DialogFooter></form>}</DialogContent></Dialog>

    <Dialog open={followupOpen} onOpenChange={setFollowupOpen}><DialogContent><DialogHeader><DialogTitle>Renovação ou prorrogação</DialogTitle><DialogDescription>Cria um novo registro vinculado à autorização original.</DialogDescription></DialogHeader>{selected && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); followup.mutate({ authorizationId: selected.id, type: String(form.get("followup_type")) as "renovacao" | "prorrogacao", justification: String(form.get("followup_justification") || ""), validFrom: String(form.get("followup_valid_from") || "") || null, validUntil: String(form.get("followup_valid_until") || "") || null, quantityRequested: Number(form.get("followup_quantity")) || null }); }} className="grid gap-4"><div className="space-y-1"><Label htmlFor="followup_type">Tipo</Label><select id="followup_type" name="followup_type" className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="renovacao">Renovação</option><option value="prorrogacao">Prorrogação</option></select></div><Field label="Quantidade solicitada" name="followup_quantity" type="number" defaultValue={Math.max(selected.quantity_requested - selected.quantity_used, 1)} /><div className="grid gap-3 md:grid-cols-2"><Field label="Válida a partir de" name="followup_valid_from" type="date" /><Field label="Válida até" name="followup_valid_until" type="date" /></div><div className="space-y-1"><Label htmlFor="followup_justification">Justificativa</Label><Textarea id="followup_justification" name="followup_justification" required /></div><DialogFooter><Button type="button" variant="ghost" onClick={() => setFollowupOpen(false)}>Cancelar</Button><Button type="submit" disabled={followup.isPending}>{followup.isPending ? "Salvando..." : "Criar"}</Button></DialogFooter></form>}</DialogContent></Dialog>
  </div>;
}
