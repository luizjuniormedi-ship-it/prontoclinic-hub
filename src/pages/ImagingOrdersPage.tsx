import { useEffect, useState } from "react";
import { FileImage, Plus, Search, Send, Eye, X, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { imagingOrdersService, imagingOrderItemsService, worklistQueueService } from "@/services/dicomService";
import { supabase } from "@/lib/supabase";
import type { ImagingOrder, ImagingOrderItem } from "@/types/dicom";
import { imagingStatusLabels, imagingStatusColors, priorityLabels, priorityColors } from "@/types/dicom";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";

const MODALITY_TYPES = ['CR','CT','MR','US','DX','XA','MG','PT','NM','RF','OT'];

interface NewItemForm {
  exam_name: string;
  modality_type: string;
  body_part: string;
  laterality: string;
  contrast_required: boolean;
  station_aetitle: string;
}

type ItemField = keyof NewItemForm;
type NewItemFormValue = string | boolean;
type LateralityLiteral = 'left' | 'right' | 'bilateral' | 'na' | '';

interface LookupPatient { id: string; full_name: string; }
interface LookupAppointment {
  id: string;
  appointment_date: string;
  start_time: string;
  status: string;
  professionals?: { full_name?: string | null } | null;
}

const emptyItemForm = (): NewItemForm => ({
  exam_name: '', modality_type: 'CR', body_part: '', laterality: '',
  contrast_required: false, station_aetitle: '',
});

export default function ImagingOrdersPage() {
  const [orders, setOrders] = useState<ImagingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<ImagingOrder | null>(null);
  const [detailItems, setDetailItems] = useState<ImagingOrderItem[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Lookups
  const [patients, setPatients] = useState<LookupPatient[]>([]);
  const [appointments, setAppointments] = useState<LookupAppointment[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(false);
  const [lookupsError, setLookupsError] = useState<string | null>(null);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState<string | null>(null);

  // New order form
  const [form, setForm] = useState({
    patient_id: '', clinical_indication: '',
    priority: 'normal', scheduling_id: '',
  });
  const [itemForms, setItemForms] = useState<NewItemForm[]>([emptyItemForm()]);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    imagingOrdersService.list({ status: statusFilter !== 'all' ? statusFilter : undefined })
      .then(setOrders)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Erro ao carregar pedidos";
        setLoadError(message);
        toast({ title: "Erro ao carregar pedidos", variant: "destructive" });
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [statusFilter]);

  const loadLookups = async () => {
    setLookupsLoading(true);
    setLookupsError(null);
    try {
      const p = await supabase.from('patients').select('id, full_name').order('full_name').limit(200);
      if (p.error) throw p.error;
      setPatients(p.data ?? []);
    } catch (error: unknown) {
      setLookupsError(error instanceof Error ? error.message : "Não foi possível carregar pacientes e profissionais.");
    } finally {
      setLookupsLoading(false);
    }
  };

  // Load appointments when patient changes
  const loadAppointments = async (patientId: string) => {
    setAppointmentsError(null);
    if (!patientId) { setAppointments([]); return; }
    setAppointmentsLoading(true);
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select('id, appointment_date, start_time, status, professionals(full_name)')
        .eq('patient_id', patientId)
        .in('status', ['scheduled', 'confirmed', 'in_progress'])
        .order('appointment_date', { ascending: false })
        .limit(20);
      if (error) throw error;
      const normalized = (data ?? []).map((d) => ({
        ...d,
        professionals: Array.isArray(d.professionals) ? d.professionals[0] ?? null : d.professionals,
      }));
      setAppointments(normalized as unknown as LookupAppointment[]);
    } catch (error: unknown) {
      setAppointments([]);
      setAppointmentsError(error instanceof Error ? error.message : "Não foi possível carregar os agendamentos do paciente.");
    } finally {
      setAppointmentsLoading(false);
    }
  };

  const openNew = () => {
    setForm({ patient_id: '', clinical_indication: '', priority: 'normal', scheduling_id: '' });
    setItemForms([emptyItemForm()]);
    setAppointments([]);
    setAppointmentsError(null);
    loadLookups();
    setDialogOpen(true);
  };

  const addItemRow = () => setItemForms([...itemForms, emptyItemForm()]);
  const removeItemRow = (idx: number) => {
    if (itemForms.length <= 1) return;
    setItemForms(itemForms.filter((_, i) => i !== idx));
  };
  const updateItemRow = (idx: number, field: ItemField, value: NewItemFormValue) => {
    setItemForms(itemForms.map((f, i) => i === idx ? { ...f, [field]: value } : f));
  };

  const createOrder = async () => {
    if (!form.patient_id) { toast({ title: "Selecione um paciente", variant: "destructive" }); return; }
    const appointmentId = Number(form.scheduling_id);
    if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) {
      toast({ title: "Selecione um agendamento válido", variant: "destructive" });
      return;
    }
    const validItems = itemForms.filter(f => f.exam_name.trim());
    if (validItems.length === 0) { toast({ title: "Adicione pelo menos um exame", variant: "destructive" }); return; }
    if (validItems.some((item) => !item.station_aetitle.trim())) {
      toast({ title: "Informe o AE Title de todos os exames", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const items = validItems.map((itemForm) => {
        return {
          exam_name: itemForm.exam_name,
          modality_type: itemForm.modality_type,
          body_part: itemForm.body_part || null,
          laterality: (itemForm.laterality as LateralityLiteral) || null,
          contrast_required: itemForm.contrast_required,
          station_aetitle: itemForm.station_aetitle.trim().toUpperCase(),
        };
      });
      const { data, error } = await supabase.rpc('m24_create_imaging_order_secure', {
        p_appointment_id: appointmentId,
        p_clinical_indication: form.clinical_indication.trim() || null,
        p_priority: form.priority,
        p_items: items,
        p_idempotency_key: `appointment:${appointmentId}`,
      });
      if (error) throw error;
      if (data === null || typeof data !== 'object') throw new Error("Resposta inválida ao criar pedido");

      toast({ title: `Pedido criado com ${validItems.length} exame(s)` });
      setDialogOpen(false);
      load();
    } catch (error: unknown) {
      toast({ title: "Erro ao criar pedido", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (order: ImagingOrder) => {
    setDetailOrder(order);
    setDetailItems([]);
    setDetailError(null);
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const items = await imagingOrderItemsService.listByOrder(order.id);
      setDetailItems(items);
    } catch (error: unknown) {
      setDetailError(error instanceof Error ? error.message : "Não foi possível carregar os exames do pedido.");
    } finally {
      setDetailLoading(false);
    }
  };

  const releaseAllToWorklist = async (order: ImagingOrder) => {
    const eligible = detailItems.filter(i => i.status === 'agendado');
    if (eligible.length === 0) { toast({ title: "Nenhum item elegível para liberação" }); return; }

    try {
      const appointmentId = order.appointment_id ?? order.scheduling_id;
      if (!appointmentId) throw new Error("Pedido sem agendamento vinculado");
      const released = await worklistQueueService.releaseAppointment(
        appointmentId,
        `imaging-order:${order.id}`,
      );
      toast({ title: `${released.length} item(ns) liberado(s) para worklist` });

      const items = await imagingOrderItemsService.listByOrder(order.id);
      setDetailItems(items);
      load();
    } catch {
      toast({ title: "Erro ao liberar itens", variant: "destructive" });
    }
  };

  const requestCancel = (order: ImagingOrder) => {
    setDetailOrder(order);
    setCancelReason("");
    setCancelOpen(true);
  };

  const cancelOrder = async () => {
    if (!detailOrder) return;
    const reason = cancelReason.trim();
    if (!reason) {
      toast({ title: "Informe o motivo do cancelamento", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('m24_cancel_imaging_order_secure', {
        p_order_id: detailOrder.id,
        p_reason: reason,
      });
      if (error) throw error;
      if (data === null || typeof data !== 'object') throw new Error("Resposta inválida ao cancelar pedido");
      toast({ title: "Pedido cancelado" });
      setCancelOpen(false);
      setDetailOpen(false);
      load();
    } catch (error: unknown) {
      toast({ title: "Erro ao cancelar pedido", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const filtered = orders.filter(o => {
    if (!search) return true;
    const q = search.toLowerCase();
    return o.patient_name?.toLowerCase().includes(q) || o.accession_number.toLowerCase().includes(q);
  });

  if (loading) return <LoadingState />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Pedidos de Exame de Imagem" description="Requisições vinculadas a pacientes, agendamentos e worklist DICOM" actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Novo Pedido</Button>} />

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente ou accession..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(imagingStatusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? <EmptyState icon={FileImage} title="Nenhum pedido de exame" description="Crie um pedido de exame de imagem para iniciar o fluxo de worklist e PACS." /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Accession</TableHead><TableHead>Paciente</TableHead><TableHead>Solicitante</TableHead>
              <TableHead>Prioridade</TableHead><TableHead>Status</TableHead><TableHead>Data</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow key={o.id} className={o.status === 'cancelado' ? 'opacity-50' : ''}>
                  <TableCell className="font-mono text-xs">{o.accession_number}</TableCell>
                  <TableCell className="font-medium text-sm">{o.patient_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.physician_name || o.referring_physician_name || '—'}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${priorityColors[o.priority]}`}>{priorityLabels[o.priority]}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${imagingStatusColors[o.status]}`}>{imagingStatusLabels[o.status]}</Badge></TableCell>
                  <TableCell className="text-xs">{formatDate(o.created_at)}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => openDetail(o)}><Eye className="h-3 w-3 mr-1" />Detalhes</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── New Order Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Pedido de Exame de Imagem</DialogTitle>
            <DialogDescription>Crie um pedido com um ou mais exames. Cada exame será um item individual na worklist.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {lookupsLoading && <LoadingState message="Carregando pacientes e profissionais..." />}
            {lookupsError && <ErrorState message={lookupsError} onRetry={loadLookups} />}
            {!lookupsLoading && !lookupsError && <>
            {/* Patient */}
            <div><Label>Paciente *</Label>
              <Select value={form.patient_id} onValueChange={(v) => { setForm({ ...form, patient_id: v, scheduling_id: '' }); loadAppointments(v); }}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>{patients.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Link to appointment */}
            {form.patient_id && (
              <div><Label className="flex items-center gap-1"><Link className="h-3 w-3" />Agendamento *</Label>
                {appointmentsLoading ? <LoadingState message="Carregando agendamentos..." /> : appointmentsError ? (
                  <ErrorState message={appointmentsError} onRetry={() => loadAppointments(form.patient_id)} />
                ) : appointments.length === 0 ? (
                  <p role="status" className="text-sm text-muted-foreground py-2">Nenhum agendamento elegível encontrado para este paciente.</p>
                ) : <Select value={form.scheduling_id} onValueChange={(v) => setForm({ ...form, scheduling_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione um agendamento..." /></SelectTrigger>
                  <SelectContent>
                    {appointments.map((a: LookupAppointment) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.appointment_date} {a.start_time} — {a.professionals?.full_name || 'Prof.'} ({a.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3">
              <div><Label>Prioridade</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(priorityLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Indicação Clínica</Label><Textarea value={form.clinical_indication} onChange={(e) => setForm({ ...form, clinical_indication: e.target.value })} /></div>

            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Exames ({itemForms.length})</p>
              <Button type="button" size="sm" variant="outline" onClick={addItemRow}><Plus className="h-3 w-3 mr-1" />Adicionar Exame</Button>
            </div>

            {itemForms.map((item, idx) => (
              <div key={idx} className="rounded-lg border p-3 space-y-3 relative">
                {itemForms.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" aria-label={`Remover exame ${idx + 1}`} className="absolute top-1 right-1 h-6 w-6 p-0" onClick={() => removeItemRow(idx)}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
                <p className="text-xs font-medium text-muted-foreground">Exame {idx + 1}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Nome do Exame *</Label><Input value={item.exam_name} onChange={(e) => updateItemRow(idx, 'exam_name', e.target.value)} placeholder="Raio-X Tórax PA/Perfil" /></div>
                  <div><Label className="text-xs">Modalidade</Label>
                    <Select value={item.modality_type} onValueChange={(v) => updateItemRow(idx, 'modality_type', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{MODALITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label className="text-xs">Região</Label><Input value={item.body_part} onChange={(e) => updateItemRow(idx, 'body_part', e.target.value)} placeholder="Tórax" /></div>
                  <div><Label className="text-xs">Lateralidade</Label>
                    <Select value={item.laterality} onValueChange={(v) => updateItemRow(idx, 'laterality', v)}>
                      <SelectTrigger><SelectValue placeholder="N/A" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="na">N/A</SelectItem>
                        <SelectItem value="left">Esquerdo</SelectItem>
                        <SelectItem value="right">Direito</SelectItem>
                        <SelectItem value="bilateral">Bilateral</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">AE Title Estação *</Label><Input value={item.station_aetitle} onChange={(e) => updateItemRow(idx, 'station_aetitle', e.target.value.toUpperCase())} className="font-mono" placeholder="CR_SALA1" required /></div>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex items-end pb-1">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={item.contrast_required} onCheckedChange={(v) => updateItemRow(idx, 'contrast_required', v)} />
                      <Label className="text-xs">Contraste</Label>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            </>}
          </div>
          <DialogFooter><Button onClick={createOrder} disabled={saving || lookupsLoading || !!lookupsError}>{saving ? 'Criando...' : 'Criar Pedido'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Detail Dialog ── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Pedido {detailOrder?.accession_number}</DialogTitle></DialogHeader>
          {detailLoading ? <LoadingState message="Carregando exames do pedido..." /> : detailError ? (
            <ErrorState message={detailError} onRetry={() => detailOrder && openDetail(detailOrder)} />
          ) : detailOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                <div><span className="text-muted-foreground">Paciente:</span> <strong>{detailOrder.patient_name}</strong></div>
                <div><span className="text-muted-foreground">Solicitante:</span> {detailOrder.physician_name || detailOrder.referring_physician_name || '—'}</div>
                <div><span className="text-muted-foreground">Prioridade:</span> <Badge variant="outline" className={`border-0 text-[10px] ${priorityColors[detailOrder.priority]}`}>{priorityLabels[detailOrder.priority]}</Badge></div>
                <div><span className="text-muted-foreground">Indicação:</span> {detailOrder.clinical_indication || '—'}</div>
                <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline" className={`border-0 text-[10px] ${imagingStatusColors[detailOrder.status]}`}>{imagingStatusLabels[detailOrder.status]}</Badge></div>
                {detailOrder.scheduling_id && <div><span className="text-muted-foreground">Agendamento:</span> <span className="font-mono text-xs">{detailOrder.scheduling_id.substring(0, 8)}...</span></div>}
              </div>

              {/* Actions bar */}
              <div className="flex gap-2 flex-wrap">
                {['agendado', 'liberado_worklist'].includes(detailOrder.status) && (
                  <>
                    {detailOrder.status === 'agendado' && detailItems.some(i => i.status === 'agendado') && (
                      <Button size="sm" onClick={() => releaseAllToWorklist(detailOrder)}>
                        <Send className="h-3 w-3 mr-1" />Liberar agendamento para Worklist
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => requestCancel(detailOrder)}>
                      <X className="h-3 w-3 mr-1" />Cancelar Pedido
                    </Button>
                  </>
                )}
              </div>

              {/* Items table */}
              <div className="rounded-lg border overflow-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Exame</TableHead><TableHead>Modalidade</TableHead><TableHead>Região</TableHead>
                    <TableHead>Lateralidade</TableHead><TableHead>Contraste</TableHead><TableHead>AE Title</TableHead>
                    <TableHead>Data/Hora</TableHead><TableHead>Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {detailItems.map((item) => (
                      <TableRow key={item.id} className={item.status === 'cancelado' ? 'opacity-50' : ''}>
                        <TableCell className="font-medium text-sm">{item.exam_name}</TableCell>
                        <TableCell><Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{item.modality_type}</Badge></TableCell>
                        <TableCell className="text-xs">{item.body_part || '—'}</TableCell>
                        <TableCell className="text-xs">{item.laterality || '—'}</TableCell>
                        <TableCell className="text-xs">{item.contrast_required ? 'Sim' : 'Não'}</TableCell>
                        <TableCell className="font-mono text-xs">{item.station_aetitle || '—'}</TableCell>
                        <TableCell className="text-xs">{item.scheduled_date ? `${item.scheduled_date} ${item.scheduled_time || ''}` : '—'}</TableCell>
                        <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${imagingStatusColors[item.status]}`}>{imagingStatusLabels[item.status]}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {detailItems.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">Nenhum exame neste pedido</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Technical info */}
              <div className="rounded-lg border p-3 space-y-1 text-xs text-muted-foreground">
                <p><strong>Procedure IDs gerados:</strong></p>
                {detailItems.map(item => (
                  <p key={item.id} className="font-mono">
                    {item.exam_name}: RPD={item.requested_procedure_id?.substring(0, 30)}... SPS={item.scheduled_procedure_step_id?.substring(0, 30)}...
                  </p>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar pedido</DialogTitle>
            <DialogDescription>Informe o motivo. O cancelamento será aplicado ao pedido inteiro e à sua integração de worklist.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="cancel-reason">Motivo *</Label>
            <Textarea id="cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={saving}>Voltar</Button>
            <Button variant="destructive" onClick={cancelOrder} disabled={saving}>{saving ? "Cancelando..." : "Confirmar cancelamento"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
