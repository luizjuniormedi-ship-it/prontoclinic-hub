import { useEffect, useState, useCallback } from "react";
import { Database, Search, Plus, Pencil, Trash2, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { catalogService } from "@/services/catalogService";
import { appointmentTypesLookup, DbAppointmentType } from "@/services/appointmentsService";
import { priceTableService } from "@/services/priceTableService";
import type { DbPriceEntry, PriceEntryInput } from "@/types/missing";
import { ConsultationType, ExamType, ProcedureType, TherapyService, HealthInsurancePlan, Room, Specialty } from "@/types";
import { formatCurrency } from "@/utils/formatters";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

export default function MasterDataPage() {
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [consultations, setConsultations] = useState<ConsultationType[]>([]);
  const [exams, setExams] = useState<ExamType[]>([]);
  const [procedures, setProcedures] = useState<ProcedureType[]>([]);
  const [therapies, setTherapies] = useState<TherapyService[]>([]);
  const [insurances, setInsurances] = useState<HealthInsurancePlan[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [prices, setPrices] = useState<DbPriceEntry[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<DbAppointmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const { user } = useAuth();

  // Price dialog
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState<DbPriceEntry | null>(null);
  const [priceForm, setPriceForm] = useState({ appointment_type_id: "", insurance_plan_id: "", price: "", description: "" });
  const [savingPrice, setSavingPrice] = useState(false);

  const loadPrices = useCallback(async () => {
    try {
      const [p, at] = await Promise.all([priceTableService.getAll(), appointmentTypesLookup.getAll()]);
      // Converter PriceTable[] → DbPriceEntry[]
      const dbEntries: DbPriceEntry[] = (p || []).map((entry) => ({
        id: entry.id,
        company_id: entry.company_id,
        appointment_type_id: entry.appointment_type_id ?? null,
        service_id: entry.service_id ?? null,
        insurance_plan_id: entry.insurance_plan_id ?? null,
        price: entry.vl_particular,
        description: entry.description ?? null,
        active: entry.active,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
      }));
      setPrices(dbEntries);
      setAppointmentTypes(at);
    } catch { /* table may not exist yet */ }
  }, []);

  useEffect(() => {
    Promise.all([
      catalogService.specialties.getAll(),
      catalogService.appointmentTypes.getConsultations(),
      catalogService.appointmentTypes.getExams(),
      catalogService.appointmentTypes.getProcedures(),
      catalogService.appointmentTypes.getTherapies(),
      catalogService.insurancePlans.getAll(),
      catalogService.rooms.getAllWithUnits(),
      loadPrices(),
    ]).then(([sp, ct, ex, pr, th, ins, rm]) => {
      setSpecialties(sp); setConsultations(ct); setExams(ex);
      setProcedures(pr); setTherapies(th); setInsurances(ins); setRooms(rm);
      setLoading(false);
    }).catch((err) => {
      console.error("Erro ao carregar cadastros:", err);
      setLoading(false);
    });
  }, [loadPrices]);

  const openNewPrice = () => {
    setEditingPrice(null);
    setPriceForm({ appointment_type_id: "", insurance_plan_id: "", price: "", description: "" });
    setPriceDialogOpen(true);
  };

  const openEditPrice = (p: DbPriceEntry) => {
    setEditingPrice(p);
    setPriceForm({
      appointment_type_id: p.appointment_type_id !== null && p.appointment_type_id !== undefined ? String(p.appointment_type_id) : "",
      insurance_plan_id: p.insurance_plan_id !== null && p.insurance_plan_id !== undefined ? String(p.insurance_plan_id) : "",
      price: String(p.price),
      description: p.description || "",
    });
    setPriceDialogOpen(true);
  };

  const handleSavePrice = async () => {
    if (!priceForm.appointment_type_id || !priceForm.price) {
      toast({ title: "Preencha tipo de atendimento e valor", variant: "destructive" });
      return;
    }
    setSavingPrice(true);
    try {
      const appointmentTypeId = Number(priceForm.appointment_type_id);
      const planId = priceForm.insurance_plan_id ? Number(priceForm.insurance_plan_id) : null;
      const priceValue = Number(priceForm.price);
      if (editingPrice) {
        await priceTableService.update(Number(editingPrice.id), {
          appointment_type_id: appointmentTypeId,
          insurance_plan_id: planId,
          vl_particular: priceValue,
          vl_convenio: priceValue,
          vl_material: 0,
          vl_medicamento: 0,
          vl_taxa: 0,
          vl_diaria: 0,
          vl_gases: 0,
          tp_calculo: "FIXO",
          percentual_acrescimo: 0,
          description: priceForm.description || undefined,
          active: true,
        });
        toast({ title: "Preço atualizado!" });
      } else {
        await priceTableService.create({
          company_id: user?.company_id || "",
          appointment_type_id: appointmentTypeId,
          insurance_plan_id: planId,
          vl_particular: priceValue,
          vl_convenio: priceValue,
          vl_material: 0,
          vl_medicamento: 0,
          vl_taxa: 0,
          vl_diaria: 0,
          vl_gases: 0,
          tp_calculo: "FIXO",
          percentual_acrescimo: 0,
          dt_inicio: new Date().toISOString().split("T")[0],
          description: priceForm.description || undefined,
          active: true,
        });
        toast({ title: "Preço cadastrado!" });
      }
      setPriceDialogOpen(false);
      await loadPrices();
    } catch (err) {
      toast({ title: "Erro", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingPrice(false);
    }
  };

  const handleDeletePrice = async (id: string | number) => {
    try {
      await priceTableService.delete(Number(id));
      toast({ title: "Preço removido" });
      await loadPrices();
    } catch (err) {
      toast({ title: "Erro", description: (err as Error).message, variant: "destructive" });
    }
  };

  if (loading) return <LoadingState />;

  const q = search.toLowerCase();
  const getTypeName = (id: string | number | null) => {
    if (id === null) return "—";
    const found = appointmentTypes.find((t) => String(t.id) === String(id));
    return found?.name || "—";
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Cadastros Mestres" description="Especialidades, consultas, exames, procedimentos, terapias, convênios, salas e preços" />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Tabs defaultValue="prices">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="prices">Preços ({prices.length})</TabsTrigger>
          <TabsTrigger value="specialties">Especialidades ({specialties.length})</TabsTrigger>
          <TabsTrigger value="consultations">Consultas ({consultations.length})</TabsTrigger>
          <TabsTrigger value="exams">Exames ({exams.length})</TabsTrigger>
          <TabsTrigger value="procedures">Procedimentos ({procedures.length})</TabsTrigger>
          <TabsTrigger value="therapies">Terapias ({therapies.length})</TabsTrigger>
          <TabsTrigger value="insurances">Convênios ({insurances.length})</TabsTrigger>
          <TabsTrigger value="rooms">Salas ({rooms.length})</TabsTrigger>
        </TabsList>

        {/* Prices */}
        <TabsContent value="prices">
          <div className="flex justify-end mb-3">
            <Button onClick={openNewPrice}><Plus className="mr-2 h-4 w-4" />Novo Preço</Button>
          </div>
          {prices.length === 0 ? (
            <EmptyState icon={DollarSign} title="Nenhum preço cadastrado" description="Cadastre preços para que o billing seja preenchido automaticamente." />
          ) : (
            <div className="rounded-lg border bg-card overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo Atendimento</TableHead>
                    <TableHead>Convênio</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prices.filter((p) => {
                    if (!search) return true;
                    const typeName = (p.appointment_type_name || getTypeName(p.appointment_type_id)).toLowerCase();
                    return typeName.includes(q) || (p.description || "").toLowerCase().includes(q);
                  }).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium text-sm">{p.appointment_type_name || getTypeName(p.appointment_type_id)}</TableCell>
                      <TableCell className="text-xs">
                        {p.insurance_plan_id ? (
                          <Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">Convênio</Badge>
                        ) : (
                          <Badge variant="outline" className="border-0 bg-muted text-muted-foreground text-[10px]">Particular</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-sm text-primary">{formatCurrency(p.price)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{p.description || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`border-0 text-[10px] ${p.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                          {p.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditPrice(p)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDeletePrice(p.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Specialties */}
        <TabsContent value="specialties">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Código</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {specialties.filter((s) => !search || s.name.toLowerCase().includes(q)).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-xs font-mono">{s.code || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${s.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{s.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="sm" className="h-7 text-xs">Editar</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Consultations */}
        <TabsContent value="consultations">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Especialidade</TableHead><TableHead>Duração</TableHead><TableHead>Valor Part.</TableHead><TableHead>Convênios</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {consultations.filter((c) => !search || c.name.toLowerCase().includes(q)).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-sm">{c.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.specialtyName}</TableCell>
                    <TableCell className="text-xs">{c.defaultDuration}min</TableCell>
                    <TableCell className="text-xs">{formatCurrency(c.particularPrice)}</TableCell>
                    <TableCell><div className="flex gap-1 flex-wrap">{c.acceptedInsurances.map((i) => <Badge key={i} variant="outline" className="border-0 bg-primary/10 text-primary text-[9px]">{i}</Badge>)}</div></TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${c.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{c.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Exams */}
        <TabsContent value="exams">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Categoria</TableHead><TableHead>Duração</TableHead><TableHead>Valor Part.</TableHead><TableHead>Preparo</TableHead><TableHead>Prioridade</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {exams.filter((e) => !search || e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium text-sm">{e.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{e.category}</TableCell>
                    <TableCell className="text-xs">{e.defaultDuration}min</TableCell>
                    <TableCell className="text-xs">{formatCurrency(e.particularPrice)}</TableCell>
                    <TableCell>{e.requiresPrep ? <Badge variant="outline" className="border-0 bg-warning/10 text-warning text-[10px]">Sim</Badge> : <span className="text-xs text-muted-foreground">Não</span>}</TableCell>
                    <TableCell className="text-xs">{e.defaultPriority === "urgent" ? <Badge variant="outline" className="border-0 bg-warning/10 text-warning text-[10px]">Urgente</Badge> : "Normal"}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${e.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{e.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Procedures */}
        <TabsContent value="procedures">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Especialidade</TableHead><TableHead>Duração</TableHead><TableHead>Valor Part.</TableHead><TableHead>Autorização</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {procedures.filter((p) => !search || p.name.toLowerCase().includes(q)).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-sm">{p.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.specialtyName}</TableCell>
                    <TableCell className="text-xs">{p.defaultDuration}min</TableCell>
                    <TableCell className="text-xs">{formatCurrency(p.particularPrice)}</TableCell>
                    <TableCell>{p.requiresAuthorization ? <Badge variant="outline" className="border-0 bg-warning/10 text-warning text-[10px]">Sim</Badge> : <span className="text-xs text-muted-foreground">Não</span>}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${p.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{p.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Therapies */}
        <TabsContent value="therapies">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>Duração</TableHead><TableHead>Valor Part.</TableHead><TableHead>Pacote</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {therapies.filter((t) => !search || t.name.toLowerCase().includes(q)).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium text-sm">{t.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.type}</TableCell>
                    <TableCell className="text-xs">{t.defaultDuration}min</TableCell>
                    <TableCell className="text-xs">{formatCurrency(t.particularPrice)}</TableCell>
                    <TableCell>{t.allowsPackage ? <Badge variant="outline" className="border-0 bg-success/10 text-success text-[10px]">Sim</Badge> : <span className="text-xs text-muted-foreground">Não</span>}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${t.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{t.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Insurances */}
        <TabsContent value="insurances">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Código</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {insurances.filter((i) => !search || i.name.toLowerCase().includes(q)).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.name}</TableCell>
                    <TableCell className="text-xs font-mono">{i.code}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{i.type}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${i.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{i.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Rooms */}
        <TabsContent value="rooms">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>Unidade</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {rooms.filter((r) => !search || r.name.toLowerCase().includes(q)).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-xs">{r.type.replace("_", " ")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.unitName}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${r.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{r.status === "active" ? "Ativo" : "Inativo"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Price Dialog */}
      <Dialog open={priceDialogOpen} onOpenChange={setPriceDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPrice ? "Editar Preço" : "Novo Preço"}</DialogTitle>
            <DialogDescription>Configure o valor por tipo de atendimento e convênio.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de Atendimento *</Label>
              <Select value={priceForm.appointment_type_id} onValueChange={(v) => setPriceForm({ ...priceForm, appointment_type_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {appointmentTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Convênio (vazio = particular)</Label>
              <Input
                placeholder="ID do convênio (deixe vazio para particular)"
                value={priceForm.insurance_plan_id}
                onChange={(e) => setPriceForm({ ...priceForm, insurance_plan_id: e.target.value })}
              />
              <p className="text-[10px] text-muted-foreground">Deixe vazio para definir o preço particular padrão.</p>
            </div>
            <div className="space-y-2">
              <Label>Valor (R$) *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="150.00"
                value={priceForm.price}
                onChange={(e) => setPriceForm({ ...priceForm, price: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input
                placeholder="Ex: Consulta padrão 30min"
                value={priceForm.description}
                onChange={(e) => setPriceForm({ ...priceForm, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSavePrice} disabled={savingPrice}>
              {savingPrice ? "Salvando..." : editingPrice ? "Atualizar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
