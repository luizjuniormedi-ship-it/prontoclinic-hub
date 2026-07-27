import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Edit3, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  DbProfessional,
  DbServiceCatalog,
  DbSpecialty,
} from "@/services/appointmentsService";
import {
  ProfessionalScheduleGrid,
  ScheduleGridInput,
  ScheduleGridStatus,
  ScheduleResource,
  scheduleGridsService,
} from "@/services/scheduleGridsService";
import { friendlyError } from "@/utils/friendlyError";

const dayLabels = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

const statusLabels: Record<ScheduleGridStatus, string> = {
  draft: "Rascunho",
  published: "Publicada",
  suspended: "Suspensa",
};

const managementRoles = new Set([
  "admin",
  "administrador",
  "gestor",
  "supervisor_recepcao",
]);

interface ScheduleGridsPanelProps {
  professionals: DbProfessional[];
  specialties: DbSpecialty[];
  services: DbServiceCatalog[];
  units: Array<{ id: string; name: string }>;
}

export function ScheduleGridsPanel({
  professionals,
  specialties,
  services,
  units,
}: ScheduleGridsPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [grids, setGrids] = useState<ProfessionalScheduleGrid[]>([]);
  const [resources, setResources] = useState<ScheduleResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGrid, setEditingGrid] = useState<ProfessionalScheduleGrid | null>(null);
  const canManage = managementRoles.has((user?.role_name || "").toLowerCase());

  const professionalNames = useMemo(
    () => new Map(professionals.map((item) => [Number(item.id), item.full_name])),
    [professionals],
  );
  const unitNames = useMemo(
    () => new Map(units.map((item) => [Number(item.id), item.name])),
    [units],
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [gridRows, resourceRows] = await Promise.all([
        scheduleGridsService.list(),
        scheduleGridsService.listResources(),
      ]);
      setGrids(gridRows);
      setResources(resourceRows);
    } catch (error) {
      toast({
        title: friendlyError(error, "Carregar grades profissionais"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingGrid(null);
    setDialogOpen(true);
  };

  const openEdit = (grid: ProfessionalScheduleGrid) => {
    setEditingGrid(grid);
    setDialogOpen(true);
  };

  const changeStatus = async (
    grid: ProfessionalScheduleGrid,
    status: ScheduleGridStatus,
  ) => {
    let reason: string | undefined;
    if (status === "suspended") {
      reason = window.prompt("Informe o motivo da suspensão:")?.trim();
      if (!reason) return;
    }
    try {
      await scheduleGridsService.setStatus(grid.id, status, reason);
      toast({ title: `Grade ${statusLabels[status].toLowerCase()}` });
      await load();
    } catch (error) {
      toast({
        title: friendlyError(error, "Alterar status da grade"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-3 pt-2" aria-label="Grades dos profissionais">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Grades profissionais</p>
          <p className="text-xs text-muted-foreground">
            Vigência, duração, unidade e capacidade usadas no cálculo de horários.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Nova grade
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando grades...</p>
      ) : grids.length === 0 ? (
        <div className="border border-dashed p-4 text-center">
          <CalendarRange className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium">Nenhuma grade cadastrada</p>
          <p className="text-xs text-muted-foreground">
            Sem grade publicada, a busca de disponibilidade não oferece horários.
          </p>
        </div>
      ) : (
        <div className="divide-y border" role="list" aria-label="Grades cadastradas">
          {grids.map((grid) => (
            <div
              key={grid.id}
              role="listitem"
              className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">
                    {professionalNames.get(grid.professional_id) ||
                      `Profissional #${grid.professional_id}`}
                  </p>
                  <Badge
                    variant={grid.status === "published" ? "default" : "outline"}
                  >
                    {statusLabels[grid.status]}
                  </Badge>
                  {grid.max_concurrent > 1 && (
                    <Badge variant="secondary">
                      Capacidade {grid.max_concurrent}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {dayLabels[grid.day_of_week]} · {grid.start_time.slice(0, 5)} às{" "}
                  {grid.end_time.slice(0, 5)} · {grid.slot_duration_minutes} min ·{" "}
                  {unitNames.get(grid.unit_id) || `Unidade #${grid.unit_id}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Vigência: {new Date(`${grid.valid_from}T00:00:00`).toLocaleDateString("pt-BR")}
                  {" até "}
                  {grid.valid_until
                    ? new Date(`${grid.valid_until}T00:00:00`).toLocaleDateString("pt-BR")
                    : "sem data final"}
                </p>
              </div>

              {canManage && (
                <div className="flex shrink-0 gap-1">
                  {grid.status === "draft" && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Editar grade"
                        aria-label={`Editar grade de ${professionalNames.get(grid.professional_id) || "profissional"}`}
                        onClick={() => openEdit(grid)}
                      >
                        <Edit3 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Publicar grade"
                        aria-label={`Publicar grade de ${professionalNames.get(grid.professional_id) || "profissional"}`}
                        onClick={() => void changeStatus(grid, "published")}
                      >
                        <Play className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                  {grid.status === "published" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Suspender grade"
                      aria-label={`Suspender grade de ${professionalNames.get(grid.professional_id) || "profissional"}`}
                      onClick={() => void changeStatus(grid, "suspended")}
                    >
                      <Pause className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                  {grid.status === "suspended" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Voltar grade para rascunho"
                      aria-label={`Reabrir grade de ${professionalNames.get(grid.professional_id) || "profissional"}`}
                      onClick={() => void changeStatus(grid, "draft")}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!canManage && (
        <p className="text-xs text-muted-foreground">
          Seu perfil pode consultar grades e disponibilidade; publicação e suspensão
          são restritas à gestão.
        </p>
      )}

      <ScheduleGridDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        grid={editingGrid}
        professionals={professionals}
        specialties={specialties}
        services={services}
        units={units}
        resources={resources}
        onSaved={async () => {
          setDialogOpen(false);
          await load();
        }}
      />
    </div>
  );
}

interface ScheduleGridDialogProps extends ScheduleGridsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grid: ProfessionalScheduleGrid | null;
  resources: ScheduleResource[];
  onSaved: () => Promise<void>;
}

function ScheduleGridDialog({
  open,
  onOpenChange,
  grid,
  professionals,
  specialties,
  services,
  units,
  resources,
  onSaved,
}: ScheduleGridDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<ScheduleGridInput>(() => emptyGridInput());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(grid ? gridToInput(grid) : emptyGridInput());
  }, [grid, open]);

  const unitResources = resources.filter(
    (resource) => String(resource.unit_id) === form.unitId,
  );
  const rooms = unitResources.filter((resource) => resource.resource_type === "room");
  const equipment = unitResources.filter(
    (resource) => resource.resource_type === "equipment",
  );

  const set = <K extends keyof ScheduleGridInput>(
    field: K,
    value: ScheduleGridInput[K],
  ) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    if (
      !form.professionalId ||
      !form.unitId ||
      !form.startTime ||
      !form.endTime ||
      !form.validFrom
    ) {
      toast({
        title: "Preencha profissional, unidade, horários e vigência",
        variant: "destructive",
      });
      return;
    }
    try {
      setSaving(true);
      await scheduleGridsService.save(form);
      toast({ title: grid ? "Grade atualizada" : "Grade criada como rascunho" });
      await onSaved();
    } catch (error) {
      toast({
        title: friendlyError(error, "Salvar grade"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{grid ? "Editar grade" : "Nova grade profissional"}</DialogTitle>
          <DialogDescription>
            A grade nasce em rascunho e só gera disponibilidade após publicação.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Profissional *</Label>
              <Select
                value={form.professionalId}
                onValueChange={(value) => set("professionalId", value)}
              >
                <SelectTrigger aria-label="Profissional da grade">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {professionals
                    .filter((professional) => professional.lg_ativo !== false)
                    .map((professional) => (
                      <SelectItem key={professional.id} value={professional.id}>
                        {professional.full_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Unidade *</Label>
              <Select
                value={form.unitId}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    unitId: value,
                    roomId: undefined,
                    equipmentId: undefined,
                  }))
                }
              >
                <SelectTrigger aria-label="Unidade da grade">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {units.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Especialidade</Label>
              <Select
                value={form.specialtyId || "none"}
                onValueChange={(value) => set("specialtyId", value)}
              >
                <SelectTrigger aria-label="Especialidade da grade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Todas</SelectItem>
                  {specialties.map((specialty) => (
                    <SelectItem key={specialty.id} value={specialty.id}>
                      {specialty.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Serviço</Label>
              <Select
                value={form.serviceId || "none"}
                onValueChange={(value) => set("serviceId", value)}
              >
                <SelectTrigger aria-label="Serviço da grade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Todos</SelectItem>
                  {services
                    .filter((service) => service.lg_ativo !== false)
                    .slice(0, 200)
                    .map((service) => (
                      <SelectItem key={service.id} value={service.id}>
                        {service.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Dia *</Label>
              <Select
                value={String(form.dayOfWeek)}
                onValueChange={(value) => set("dayOfWeek", Number(value))}
              >
                <SelectTrigger aria-label="Dia da semana da grade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dayLabels.map((label, index) => (
                    <SelectItem key={label} value={String(index)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grid-start-time">Início *</Label>
              <Input
                id="grid-start-time"
                type="time"
                value={form.startTime}
                onChange={(event) => set("startTime", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grid-end-time">Fim *</Label>
              <Input
                id="grid-end-time"
                type="time"
                value={form.endTime}
                onChange={(event) => set("endTime", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Duração *</Label>
              <Select
                value={String(form.durationMinutes)}
                onValueChange={(value) => set("durationMinutes", Number(value))}
              >
                <SelectTrigger aria-label="Duração dos horários">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 15, 20, 30, 40, 45, 60, 90, 120].map((duration) => (
                    <SelectItem key={duration} value={String(duration)}>
                      {duration} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="grid-valid-from">Vigência inicial *</Label>
              <Input
                id="grid-valid-from"
                type="date"
                value={form.validFrom}
                onChange={(event) => set("validFrom", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grid-valid-until">Vigência final</Label>
              <Input
                id="grid-valid-until"
                type="date"
                value={form.validUntil || ""}
                onChange={(event) => set("validUntil", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Capacidade simultânea</Label>
              <Select
                value={String(form.maxConcurrent)}
                onValueChange={(value) => set("maxConcurrent", Number(value))}
              >
                <SelectTrigger aria-label="Capacidade simultânea da grade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((capacity) => (
                    <SelectItem key={capacity} value={String(capacity)}>
                      {capacity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Sala</Label>
              <Select
                value={form.roomId || "none"}
                onValueChange={(value) => set("roomId", value)}
                disabled={!form.unitId}
              >
                <SelectTrigger aria-label="Sala da grade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem sala fixa</SelectItem>
                  {rooms.map((resource) => (
                    <SelectItem key={resource.id} value={String(resource.id)}>
                      {resource.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Equipamento</Label>
              <Select
                value={form.equipmentId || "none"}
                onValueChange={(value) => set("equipmentId", value)}
                disabled={!form.unitId}
              >
                <SelectTrigger aria-label="Equipamento da grade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem equipamento fixo</SelectItem>
                  {equipment.map((resource) => (
                    <SelectItem key={resource.id} value={String(resource.id)}>
                      {resource.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="grid-notes">Observações</Label>
            <Textarea
              id="grid-notes"
              value={form.notes || ""}
              onChange={(event) => set("notes", event.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Salvando..." : "Salvar rascunho"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function emptyGridInput(): ScheduleGridInput {
  return {
    professionalId: "",
    unitId: "",
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "12:00",
    durationMinutes: 30,
    validFrom: new Date().toISOString().slice(0, 10),
    maxConcurrent: 1,
  };
}

function gridToInput(grid: ProfessionalScheduleGrid): ScheduleGridInput {
  return {
    id: grid.id,
    professionalId: String(grid.professional_id),
    unitId: String(grid.unit_id),
    dayOfWeek: grid.day_of_week,
    startTime: grid.start_time.slice(0, 5),
    endTime: grid.end_time.slice(0, 5),
    durationMinutes: grid.slot_duration_minutes,
    validFrom: grid.valid_from,
    validUntil: grid.valid_until || undefined,
    specialtyId: grid.specialty_id ? String(grid.specialty_id) : "none",
    serviceId: grid.service_id ? String(grid.service_id) : "none",
    roomId: grid.room_id ? String(grid.room_id) : "none",
    equipmentId: grid.equipment_id ? String(grid.equipment_id) : "none",
    maxConcurrent: grid.max_concurrent,
    notes: grid.notes || "",
  };
}
