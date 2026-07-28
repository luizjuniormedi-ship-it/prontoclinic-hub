import { useCallback, useEffect, useState } from "react";
import { Boxes, Building2, CalendarClock, MapPin, Pencil, Plus, Power } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, LoadingState } from "@/components/StateViews";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { catalogService } from "@/services/catalogService";
import { organizationalStructureService, type CatalogServiceOption, type OrganizationalResource, type OrganizationSector, type ResourceType, type SectorType, type UnitSchedule, type UnitService } from "@/services/organizationalStructureService";
import { resolveInitialUnit } from "@/services/organizationalStructureResolver";
import type { Unit } from "@/types";

const resourceLabels: Record<ResourceType, string> = {
  room: "Sala",
  office: "Consultório",
  bed: "Leito",
  equipment: "Equipamento",
  inventory_location: "Local de estoque",
  cost_center: "Centro de custo",
};

const sectorLabels: Record<SectorType, string> = {
  administrative: "Administrativo",
  clinical: "Clínico",
  diagnostic: "Diagnóstico",
  operational: "Operacional",
  support: "Apoio",
};

export default function OrganizationalStructurePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [sectors, setSectors] = useState<OrganizationSector[]>([]);
  const [resources, setResources] = useState<OrganizationalResource[]>([]);
  const [schedules, setSchedules] = useState<UnitSchedule[]>([]);
  const [unitServices, setUnitServices] = useState<UnitService[]>([]);
  const [catalogServices, setCatalogServices] = useState<CatalogServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectorDialog, setSectorDialog] = useState(false);
  const [resourceDialog, setResourceDialog] = useState(false);
  const [editingSector, setEditingSector] = useState<OrganizationSector | null>(null);
  const [editingResource, setEditingResource] = useState<OrganizationalResource | null>(null);
  const [sectorForm, setSectorForm] = useState({ code: "", name: "", sector_type: "operational" as SectorType });
  const [resourceForm, setResourceForm] = useState({ code: "", name: "", resource_type: "room" as ResourceType, sector_id: "" });
  const [scheduleDialog, setScheduleDialog] = useState(false);
  const [serviceDialog, setServiceDialog] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ sector_id: "", resource_id: "", day_of_week: "1", start_time: "08:00", end_time: "18:00" });
  const [serviceForm, setServiceForm] = useState({ service_id: "", duration_minutes: "30" });

  const load = useCallback(async (selectedUnitId: number | null) => {
    if (!selectedUnitId) {
      setSectors([]); setResources([]); setLoading(false); return;
    }
    setLoading(true);
    try {
      const [nextSectors, nextResources, nextSchedules, nextUnitServices] = await Promise.all([
        organizationalStructureService.listSectors(selectedUnitId),
        organizationalStructureService.listResources(selectedUnitId),
        organizationalStructureService.listSchedules(selectedUnitId),
        organizationalStructureService.listUnitServices(selectedUnitId),
      ]);
      setSectors(nextSectors); setResources(nextResources); setSchedules(nextSchedules); setUnitServices(nextUnitServices);
    } catch (error) {
      toast({ title: "Não foi possível carregar a estrutura", description: error instanceof Error ? error.message : "Verifique sua permissão.", variant: "destructive" });
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => {
    catalogService.units.getAll().then((nextUnits) => {
      setUnits(nextUnits);
      void organizationalStructureService.listCatalogServices().then(setCatalogServices).catch(() => setCatalogServices([]));
      const preferred = user?.primary_unit_id ? Number(user.primary_unit_id) : null;
      const nextUnitId = resolveInitialUnit(nextUnits.map((unit) => ({ id: Number(unit.id), name: unit.name })), preferred);
      setUnitId(nextUnitId);
      return load(nextUnitId);
    }).catch((error) => {
      toast({ title: "Não foi possível carregar as unidades", description: error instanceof Error ? error.message : "Erro inesperado.", variant: "destructive" });
      setLoading(false);
    });
  }, [load, toast, user?.primary_unit_id]);

  useEffect(() => { void load(unitId); }, [load, unitId]);

  const reload = () => load(unitId);
  const selectedUnit = units.find((unit) => Number(unit.id) === unitId);

  const openSectorEdit = (sector: OrganizationSector) => {
    setEditingSector(sector);
    setSectorForm({ code: sector.code, name: sector.name, sector_type: sector.sector_type });
    setSectorDialog(true);
  };

  const openResourceEdit = (resource: OrganizationalResource) => {
    setEditingResource(resource);
    setResourceForm({ code: resource.code, name: resource.name, resource_type: resource.resource_type, sector_id: resource.sector_id ? String(resource.sector_id) : "" });
    setResourceDialog(true);
  };

  const createSector = async () => {
    if (!unitId || !user?.company_id || !sectorForm.code || !sectorForm.name) return;
    try {
      if (editingSector) {
        await organizationalStructureService.updateSector(editingSector.id, sectorForm);
      } else {
        await organizationalStructureService.createSector({ company_id: user.company_id, unit_id: unitId, ...sectorForm });
      }
      setSectorDialog(false); setEditingSector(null); setSectorForm({ code: "", name: "", sector_type: "operational" });
      toast({ title: editingSector ? "Setor atualizado" : "Setor criado" }); await reload();
    } catch (error) { toast({ title: "Erro ao criar setor", description: error instanceof Error ? error.message : "Erro inesperado.", variant: "destructive" }); }
  };

  const createResource = async () => {
    if (!unitId || !user?.company_id || !resourceForm.code || !resourceForm.name) return;
    try {
      const input = { ...resourceForm, sector_id: resourceForm.sector_id ? Number(resourceForm.sector_id) : null };
      if (editingResource) {
        await organizationalStructureService.updateResource(editingResource.id, input);
      } else {
        await organizationalStructureService.createResource({ company_id: user.company_id, unit_id: unitId, ...input });
      }
      setResourceDialog(false); setEditingResource(null); setResourceForm({ code: "", name: "", resource_type: "room", sector_id: "" });
      toast({ title: editingResource ? "Recurso atualizado" : "Recurso criado" }); await reload();
    } catch (error) { toast({ title: "Erro ao criar recurso", description: error instanceof Error ? error.message : "Erro inesperado.", variant: "destructive" }); }
  };

  const createSchedule = async () => {
    if (!unitId || !user?.company_id || (!scheduleForm.sector_id && !scheduleForm.resource_id)) return;
    try {
      await organizationalStructureService.createSchedule({ company_id: user.company_id, unit_id: unitId, sector_id: scheduleForm.sector_id ? Number(scheduleForm.sector_id) : null, resource_id: scheduleForm.resource_id ? Number(scheduleForm.resource_id) : null, day_of_week: Number(scheduleForm.day_of_week), start_time: scheduleForm.start_time, end_time: scheduleForm.end_time, timezone: "America/Sao_Paulo" });
      setScheduleDialog(false); toast({ title: "Horário criado" }); await reload();
    } catch (error) { toast({ title: "Erro ao criar horário", description: error instanceof Error ? error.message : "Erro inesperado.", variant: "destructive" }); }
  };

  const assignService = async () => {
    if (!unitId || !user?.company_id || !serviceForm.service_id) return;
    try {
      await organizationalStructureService.assignService({ company_id: user.company_id, unit_id: unitId, service_id: Number(serviceForm.service_id), duration_minutes: Number(serviceForm.duration_minutes) });
      setServiceDialog(false); toast({ title: "Serviço habilitado na unidade" }); await reload();
    } catch (error) { toast({ title: "Erro ao habilitar serviço", description: error instanceof Error ? error.message : "Erro inesperado.", variant: "destructive" }); }
  };

  const deactivateSector = async (sector: OrganizationSector) => {
    try { await organizationalStructureService.updateSector(sector.id, { lg_ativo: false }); toast({ title: "Setor inativado" }); await reload(); }
    catch (error) { toast({ title: "Erro ao inativar setor", description: error instanceof Error ? error.message : "Erro inesperado.", variant: "destructive" }); }
  };

  const deactivateResource = async (resource: OrganizationalResource) => {
    try { await organizationalStructureService.updateResource(resource.id, { status: "inactive" }); toast({ title: "Recurso inativado" }); await reload(); }
    catch (error) { toast({ title: "Erro ao inativar recurso", description: error instanceof Error ? error.message : "Erro inesperado.", variant: "destructive" }); }
  };

  const deactivateSchedule = async (schedule: UnitSchedule) => {
    try { await organizationalStructureService.updateSchedule(schedule.id, { lg_ativo: false }); toast({ title: "Horário inativado" }); await reload(); }
    catch (error) { toast({ title: "Erro ao inativar horário", description: error instanceof Error ? error.message : "Erro inesperado.", variant: "destructive" }); }
  };

  const deactivateUnitService = async (service: UnitService) => {
    try { await organizationalStructureService.updateUnitService(service.id, { lg_ativo: false }); toast({ title: "Serviço desabilitado" }); await reload(); }
    catch (error) { toast({ title: "Erro ao desabilitar serviço", description: error instanceof Error ? error.message : "Erro inesperado.", variant: "destructive" }); }
  };

  if (loading && !units.length) return <LoadingState />;

  return <div className="space-y-6 animate-fade-in">
    <PageHeader title="Estrutura organizacional" description="Unidade, setores e recursos operacionais com escopo multiunidade" actions={<div className="flex gap-2"><Button variant="outline" onClick={() => setSectorDialog(true)} disabled={!unitId}><Plus className="mr-2 h-4 w-4" />Novo setor</Button><Button variant="outline" onClick={() => setScheduleDialog(true)} disabled={!unitId}><CalendarClock className="mr-2 h-4 w-4" />Novo horário</Button><Button onClick={() => setResourceDialog(true)} disabled={!unitId}><Plus className="mr-2 h-4 w-4" />Novo recurso</Button></div>} />
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
      <Building2 className="h-5 w-5 text-primary" />
      <Label htmlFor="organization-unit">Unidade ativa</Label>
      <Select value={unitId ? String(unitId) : ""} onValueChange={(value) => setUnitId(Number(value))}>
        <SelectTrigger id="organization-unit" className="max-w-sm"><SelectValue placeholder="Selecione uma unidade" /></SelectTrigger>
        <SelectContent>{units.map((unit) => <SelectItem key={unit.id} value={String(unit.id)}>{unit.name} ({unit.code})</SelectItem>)}</SelectContent>
      </Select>
      {selectedUnit && <Badge variant="outline">{selectedUnit.status === "active" ? "Ativa" : "Inativa"}</Badge>}
    </div>
    <Tabs defaultValue="sectors">
      <TabsList><TabsTrigger value="sectors">Setores ({sectors.length})</TabsTrigger><TabsTrigger value="resources">Recursos ({resources.length})</TabsTrigger><TabsTrigger value="schedules">Horários ({schedules.length})</TabsTrigger><TabsTrigger value="services">Serviços ({unitServices.length})</TabsTrigger></TabsList>
      <TabsContent value="sectors" className="mt-4">
        {sectors.length === 0 ? <EmptyState icon={MapPin} title="Nenhum setor cadastrado" /> : <div className="rounded-lg border bg-card overflow-auto"><Table><TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead><TableHead className="w-24">Ações</TableHead></TableRow></TableHeader><TableBody>{sectors.map((sector) => <TableRow key={sector.id}><TableCell className="font-mono text-xs">{sector.code}</TableCell><TableCell className="font-medium">{sector.name}</TableCell><TableCell>{sectorLabels[sector.sector_type]}</TableCell><TableCell><Badge variant="outline" className="text-success">Ativo</Badge></TableCell><TableCell><div className="flex gap-1"><Button variant="ghost" size="icon" aria-label={`Editar setor ${sector.name}`} onClick={() => openSectorEdit(sector)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" aria-label={`Inativar setor ${sector.name}`} onClick={() => void deactivateSector(sector)}><Power className="h-4 w-4" /></Button></div></TableCell></TableRow>)}</TableBody></Table></div>}
      </TabsContent>
      <TabsContent value="schedules" className="mt-4">
        {schedules.length === 0 ? <EmptyState icon={CalendarClock} title="Nenhum horário cadastrado" /> : <div className="rounded-lg border bg-card overflow-auto"><Table><TableHeader><TableRow><TableHead>Dia</TableHead><TableHead>Início</TableHead><TableHead>Fim</TableHead><TableHead>Fuso</TableHead><TableHead className="w-16">Ações</TableHead></TableRow></TableHeader><TableBody>{schedules.map((schedule) => <TableRow key={schedule.id}><TableCell>{["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][schedule.day_of_week]}</TableCell><TableCell>{schedule.start_time.slice(0, 5)}</TableCell><TableCell>{schedule.end_time.slice(0, 5)}</TableCell><TableCell>{schedule.timezone}</TableCell><TableCell><Button variant="ghost" size="icon" aria-label="Inativar horário" onClick={() => void deactivateSchedule(schedule)}><Power className="h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table></div>}
      </TabsContent>
      <TabsContent value="services" className="mt-4">
        <div className="mb-3 flex justify-end"><Button variant="outline" onClick={() => setServiceDialog(true)} disabled={!catalogServices.length}><Plus className="mr-2 h-4 w-4" />Habilitar serviço</Button></div>
        {unitServices.length === 0 ? <EmptyState icon={Boxes} title="Nenhum serviço habilitado" /> : <div className="rounded-lg border bg-card overflow-auto"><Table><TableHeader><TableRow><TableHead>Serviço</TableHead><TableHead>Duração</TableHead><TableHead>Status</TableHead><TableHead className="w-16">Ações</TableHead></TableRow></TableHeader><TableBody>{unitServices.map((service) => <TableRow key={service.id}><TableCell>{catalogServices.find((item) => item.id === service.service_id)?.name ?? `Serviço ${service.service_id}`}</TableCell><TableCell>{service.duration_minutes} min</TableCell><TableCell><Badge variant="outline" className="text-success">Ativo</Badge></TableCell><TableCell><Button variant="ghost" size="icon" aria-label="Desabilitar serviço" onClick={() => void deactivateUnitService(service)}><Power className="h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table></div>}
      </TabsContent>
      <TabsContent value="resources" className="mt-4">
        {resources.length === 0 ? <EmptyState icon={Boxes} title="Nenhum recurso cadastrado" /> : <div className="rounded-lg border bg-card overflow-auto"><Table><TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead><TableHead className="w-24">Ações</TableHead></TableRow></TableHeader><TableBody>{resources.map((resource) => <TableRow key={resource.id}><TableCell className="font-mono text-xs">{resource.code}</TableCell><TableCell className="font-medium">{resource.name}</TableCell><TableCell>{resourceLabels[resource.resource_type]}</TableCell><TableCell><Badge variant="outline" className={resource.status === "active" ? "text-success" : "text-warning"}>{resource.status}</Badge></TableCell><TableCell><div className="flex gap-1"><Button variant="ghost" size="icon" aria-label={`Editar recurso ${resource.name}`} onClick={() => openResourceEdit(resource)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" aria-label={`Inativar recurso ${resource.name}`} onClick={() => void deactivateResource(resource)}><Power className="h-4 w-4" /></Button></div></TableCell></TableRow>)}</TableBody></Table></div>}
      </TabsContent>
    </Tabs>
    <Dialog open={sectorDialog} onOpenChange={(open) => { setSectorDialog(open); if (!open) setEditingSector(null); }}><DialogContent><DialogHeader><DialogTitle>{editingSector ? "Editar setor" : "Novo setor"}</DialogTitle><DialogDescription>O setor ficará vinculado à unidade selecionada.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>Código *</Label><Input value={sectorForm.code} onChange={(event) => setSectorForm({ ...sectorForm, code: event.target.value })} /></div><div><Label>Nome *</Label><Input value={sectorForm.name} onChange={(event) => setSectorForm({ ...sectorForm, name: event.target.value })} /></div><div><Label>Tipo</Label><Select value={sectorForm.sector_type} onValueChange={(value) => setSectorForm({ ...sectorForm, sector_type: value as SectorType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(sectorLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div></div><DialogFooter><Button variant="outline" onClick={() => setSectorDialog(false)}>Cancelar</Button><Button onClick={createSector}>{editingSector ? "Salvar alterações" : "Criar setor"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={resourceDialog} onOpenChange={(open) => { setResourceDialog(open); if (!open) setEditingResource(null); }}><DialogContent><DialogHeader><DialogTitle>{editingResource ? "Editar recurso" : "Novo recurso"}</DialogTitle><DialogDescription>Cadastre uma sala, leito, equipamento ou recurso de apoio.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>Código *</Label><Input value={resourceForm.code} onChange={(event) => setResourceForm({ ...resourceForm, code: event.target.value })} /></div><div><Label>Nome *</Label><Input value={resourceForm.name} onChange={(event) => setResourceForm({ ...resourceForm, name: event.target.value })} /></div><div><Label>Tipo</Label><Select value={resourceForm.resource_type} onValueChange={(value) => setResourceForm({ ...resourceForm, resource_type: value as ResourceType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(resourceLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div><div><Label>Setor</Label><Select value={resourceForm.sector_id || "none"} onValueChange={(value) => setResourceForm({ ...resourceForm, sector_id: value === "none" ? "" : value })}><SelectTrigger><SelectValue placeholder="Sem setor" /></SelectTrigger><SelectContent><SelectItem value="none">Sem setor</SelectItem>{sectors.map((sector) => <SelectItem key={sector.id} value={String(sector.id)}>{sector.name}</SelectItem>)}</SelectContent></Select></div></div><DialogFooter><Button variant="outline" onClick={() => setResourceDialog(false)}>Cancelar</Button><Button onClick={createResource}>{editingResource ? "Salvar alterações" : "Criar recurso"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={scheduleDialog} onOpenChange={setScheduleDialog}><DialogContent><DialogHeader><DialogTitle>Novo horário</DialogTitle><DialogDescription>Defina um horário para setor ou recurso da unidade.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>Setor</Label><Select value={scheduleForm.sector_id || "none"} onValueChange={(value) => setScheduleForm({ ...scheduleForm, sector_id: value === "none" ? "" : value, resource_id: "" })}><SelectTrigger><SelectValue placeholder="Selecione um setor" /></SelectTrigger><SelectContent><SelectItem value="none">Nenhum</SelectItem>{sectors.map((sector) => <SelectItem key={sector.id} value={String(sector.id)}>{sector.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Recurso</Label><Select value={scheduleForm.resource_id || "none"} onValueChange={(value) => setScheduleForm({ ...scheduleForm, resource_id: value === "none" ? "" : value, sector_id: "" })}><SelectTrigger><SelectValue placeholder="Selecione um recurso" /></SelectTrigger><SelectContent><SelectItem value="none">Nenhum</SelectItem>{resources.map((resource) => <SelectItem key={resource.id} value={String(resource.id)}>{resource.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Dia</Label><Select value={scheduleForm.day_of_week} onValueChange={(value) => setScheduleForm({ ...scheduleForm, day_of_week: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div><Label>Início</Label><Input type="time" value={scheduleForm.start_time} onChange={(event) => setScheduleForm({ ...scheduleForm, start_time: event.target.value })} /></div><div><Label>Fim</Label><Input type="time" value={scheduleForm.end_time} onChange={(event) => setScheduleForm({ ...scheduleForm, end_time: event.target.value })} /></div></div></div><DialogFooter><Button variant="outline" onClick={() => setScheduleDialog(false)}>Cancelar</Button><Button onClick={createSchedule}>Criar horário</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={serviceDialog} onOpenChange={setServiceDialog}><DialogContent><DialogHeader><DialogTitle>Habilitar serviço</DialogTitle><DialogDescription>Escolha um serviço do catálogo para esta unidade.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>Serviço</Label><Select value={serviceForm.service_id} onValueChange={(value) => setServiceForm({ ...serviceForm, service_id: value })}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{catalogServices.map((service) => <SelectItem key={service.id} value={String(service.id)}>{service.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Duração (minutos)</Label><Input type="number" min="1" max="1440" value={serviceForm.duration_minutes} onChange={(event) => setServiceForm({ ...serviceForm, duration_minutes: event.target.value })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setServiceDialog(false)}>Cancelar</Button><Button onClick={assignService}>Habilitar</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
