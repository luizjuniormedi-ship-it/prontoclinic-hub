import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { DbProfessional, DbSpecialty, DbAppointmentType, DbServiceCatalog, SchedulingRequirements, appointmentsService } from "@/services/appointmentsService";
import { patientsService } from "@/services/patientsService";
import { validateAppointmentFields, checkOverlap, checkReturnRule, handleServiceError } from "@/services/validationService";
import { Patient } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccessContext } from "@/hooks/useActiveAccessRole";
import { supabase } from "@/lib/supabase";

type ProfessionalUnitLink = {
  professional_id: string | number;
  unit_id?: string | number | null;
  slot1_unit_id?: string | number | null;
  slot2_unit_id?: string | number | null;
  slot3_unit_id?: string | number | null;
};

export function canonicalUnitId(value: string | number | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

export function professionalIdsForUnit(
  rows: ProfessionalUnitLink[],
  unitId: string | number | null | undefined,
): Set<string> {
  const canonical = canonicalUnitId(unitId);
  if (!canonical) return new Set();
  return new Set(
    rows
      .filter((row) => [
        row.unit_id,
        row.slot1_unit_id,
        row.slot2_unit_id,
        row.slot3_unit_id,
      ].some((candidate) => canonicalUnitId(candidate) === canonical))
      .map((row) => String(row.professional_id)),
  );
}

export function filterProfessionalsForUnit(
  professionals: DbProfessional[],
  linkedProfessionalIds: Set<string>,
): DbProfessional[] {
  return professionals.filter((professional) => {
    const status = professional.status?.toLowerCase();
    const active = status
      ? status === "active" || status === "ativo"
      : professional.lg_ativo !== false;
    return active && linkedProfessionalIds.has(String(professional.id));
  });
}

interface NewAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  professionals: DbProfessional[];
  specialties: DbSpecialty[];
  appointmentTypes: DbAppointmentType[];
  services: DbServiceCatalog[];
  insurances: Array<{ id: string; name: string }>;
  patients: Patient[];
  selectedDate: string;
  onCreated: () => void;
}

export function NewAppointmentDialog({ open, onOpenChange, professionals, specialties, appointmentTypes, services, insurances, patients, selectedDate, onCreated }: NewAppointmentDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const activeContext = useActiveAccessContext(user?.role_name, user?.company_id);
  const activeUnitId = canonicalUnitId(activeContext.unitId);
  const [patientId, setPatientId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [appointmentTypeId, setAppointmentTypeId] = useState("");
  const [date, setDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isReturn, setIsReturn] = useState(false);
  const [notes, setNotes] = useState("");
  const [serviceId, setServiceId] = useState("none");
  const [serviceSearch, setServiceSearch] = useState("");
  const [insuranceId, setInsuranceId] = useState("private");
  const [cardNumber, setCardNumber] = useState("");
  const [authorizationNumber, setAuthorizationNumber] = useState("");
  const [requirements, setRequirements] = useState<SchedulingRequirements | null>(null);
  const [saving, setSaving] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [linkedProfessionalIds, setLinkedProfessionalIds] = useState<Set<string>>(new Set());
  const [unitProfessionalsLoading, setUnitProfessionalsLoading] = useState(false);
  const [unitProfessionalsError, setUnitProfessionalsError] = useState<string | null>(null);

  // Validation states
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  const [returnWarning, setReturnWarning] = useState<string | null>(null);
  const [returnOverrideConfirmed, setReturnOverrideConfirmed] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Reset on selectedDate change
  useEffect(() => { setDate(selectedDate); }, [selectedDate]);

  const loadUnitProfessionals = useCallback(async () => {
    if (!activeUnitId) {
      setLinkedProfessionalIds(new Set());
      setUnitProfessionalsError("Selecione uma unidade operacional antes de criar o agendamento.");
      return;
    }

    try {
      setUnitProfessionalsLoading(true);
      setUnitProfessionalsError(null);
      let query = supabase
        .from("professional_schedules")
        .select("professional_id, unit_id, slot1_unit_id, slot2_unit_id, slot3_unit_id")
        .eq("lg_habilitado", true);
      if (activeContext.companyId) {
        query = query.eq("company_id", activeContext.companyId);
      }
      const { data, error } = await query;
      if (error) throw error;
      setLinkedProfessionalIds(professionalIdsForUnit(
        (data ?? []) as ProfessionalUnitLink[],
        activeUnitId,
      ));
    } catch (error) {
      setLinkedProfessionalIds(new Set());
      setUnitProfessionalsError(
        error instanceof Error
          ? `Não foi possível carregar os profissionais da unidade: ${error.message}`
          : "Não foi possível carregar os profissionais da unidade.",
      );
    } finally {
      setUnitProfessionalsLoading(false);
    }
  }, [activeContext.companyId, activeUnitId]);

  useEffect(() => {
    if (open) void loadUnitProfessionals();
  }, [loadUnitProfessionals, open]);

  const resetForm = () => {
    setPatientId(""); setProfessionalId(""); setSpecialtyId("");
    setAppointmentTypeId(""); setDate(selectedDate); setStartTime("");
    setEndTime(""); setIsReturn(false); setNotes(""); setSaving(false);
    setServiceId("none"); setServiceSearch(""); setInsuranceId("private"); setCardNumber("");
    setAuthorizationNumber(""); setRequirements(null);
    setPatientSearch(""); setPatientResults([]); setPatientSearchLoading(false);
    setOverlapWarning(null); setReturnWarning(null);
    setReturnOverrideConfirmed(false); setValidationErrors([]);
  };

  const handleClose = () => { resetForm(); onOpenChange(false); };

  // Auto-calculate end time based on appointment type duration
  const handleStartTimeChange = (time: string) => {
    setStartTime(time);
    setOverlapWarning(null);
    const selectedType = appointmentTypes.find((t) => t.id === appointmentTypeId);
    const prof = professionals.find((p) => p.id === professionalId);
    const duration = selectedType?.default_duration_minutes || prof?.default_duration_minutes || 30;
    if (time) {
      const [h, m] = time.split(":").map(Number);
      const endMinutes = h * 60 + m + duration;
      const eh = Math.floor(endMinutes / 60);
      const em = endMinutes % 60;
      setEndTime(`${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`);
    }
  };

  // Check overlap when professional, date, or time changes
  useEffect(() => {
    if (!professionalId || !date || !startTime || !endTime) {
      setOverlapWarning(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await checkOverlap(professionalId, date, startTime, endTime);
        if (result.hasOverlap && result.conflicting) {
          const conflict = result.conflicting;
          setOverlapWarning(
            `Conflito de horário: já existe agendamento às ${conflict.start_time?.substring(0, 5)} - ${conflict.end_time?.substring(0, 5)}.`
          );
        } else {
          setOverlapWarning(null);
        }
      } catch {
        // Silently ignore overlap check errors
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [professionalId, date, startTime, endTime]);

  // Check 30-day return rule when patient + specialty changes
  useEffect(() => {
    if (!patientId || !specialtyId) {
      setReturnWarning(null);
      setReturnOverrideConfirmed(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await checkReturnRule(patientId, specialtyId);
        if (result.blocked) {
          const specName = specialties.find((s) => s.id === specialtyId)?.name || "esta especialidade";
          setReturnWarning(
            `Consulta em ${specName} realizada há ${result.daysPassed} dias (${formatDate(result.lastDate!)}). Próxima liberada em ${formatDate(result.availableDate!)}.`
          );
          setReturnOverrideConfirmed(false);
        } else {
          setReturnWarning(null);
        }
      } catch {
        // Silently ignore
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [patientId, specialtyId, specialties]);

  useEffect(() => {
    const term = patientSearch.trim();
    if (term.length < 2) {
      setPatientResults([]);
      setPatientSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setPatientSearchLoading(true);
        const result = await patientsService.search(term);
        if (!cancelled) setPatientResults(result.slice(0, 50));
      } catch {
        if (!cancelled) setPatientResults([]);
      } finally {
        if (!cancelled) setPatientSearchLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [patientSearch]);

  const patientOptions = patientSearch.trim().length >= 2 ? patientResults : patients;
  const activeProfessionals = useMemo(
    () => filterProfessionalsForUnit(professionals, linkedProfessionalIds),
    [linkedProfessionalIds, professionals],
  );

  useEffect(() => {
    if (professionalId && !activeProfessionals.some((professional) => professional.id === professionalId)) {
      setProfessionalId("");
    }
  }, [activeProfessionals, professionalId]);

  useEffect(() => {
    if (!patientId || !professionalId) { setRequirements(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await appointmentsService.getRequirements({
          patientId,
          professionalId,
          serviceId: serviceId === "none" ? undefined : serviceId,
          insuranceId: insuranceId === "private" ? undefined : insuranceId,
          cardNumber,
        });
        if (!cancelled) {
          setRequirements(result);
          if (!cardNumber && result.card_number) setCardNumber(result.card_number);
        }
      } catch (error) {
        if (!cancelled) setRequirements({ errors: [error instanceof Error ? error.message : "Falha na validação"] } as SchedulingRequirements);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [patientId, professionalId, serviceId, insuranceId, cardNumber]);

  const handleSubmit = async () => {
    if (!activeUnitId) {
      setValidationErrors(["Selecione uma unidade operacional antes de criar o agendamento."]);
      return;
    }
    if (!linkedProfessionalIds.has(String(professionalId))) {
      setValidationErrors(["Selecione um profissional habilitado na unidade ativa."]);
      return;
    }

    // Validate fields
    const errors = validateAppointmentFields({
      patient_id: patientId,
      professional_id: professionalId,
      appointment_date: date,
      start_time: startTime,
      end_time: endTime,
    });

    if (errors.length > 0) {
      setValidationErrors(errors.map((e) => e.message));
      return;
    }

    // Block on overlap
    if (overlapWarning) {
      toast({ title: "Conflito de horário", description: "Resolva o conflito antes de agendar.", variant: "destructive" });
      return;
    }
    if (requirements?.errors.length) {
      setValidationErrors(requirements.errors);
      return;
    }

    // Block on return rule unless overridden
    if (returnWarning && !returnOverrideConfirmed) {
      toast({ title: "Regra de retorno", description: "Confirme o override da regra de 30 dias.", variant: "destructive" });
      return;
    }

    try {
      setSaving(true);
      setValidationErrors([]);

      await appointmentsService.create({
        company_id: activeContext.companyId || user?.company_id || undefined,
        unit_id: activeUnitId,
        patient_id: patientId,
        professional_id: professionalId,
        specialty_id: specialtyId || undefined,
        appointment_type_id: appointmentTypeId || undefined,
        service_id: serviceId === "none" ? undefined : serviceId,
        insurance_id: insuranceId === "private" ? undefined : insuranceId,
        card_number: cardNumber || undefined,
        authorization_number: authorizationNumber || undefined,
        appointment_date: date,
        start_time: startTime,
        end_time: endTime || undefined,
        is_return: isReturn || returnOverrideConfirmed,
        notes: returnOverrideConfirmed
          ? `[Override 30 dias] ${notes || ""}`.trim()
          : notes || undefined,
        status: "scheduled",
      });

      toast({ title: "✓ Agendamento criado com sucesso!" });
      handleClose();
      onCreated();
    } catch (err) {
      const msg = handleServiceError(err, "criar agendamento");
      toast({ title: "Erro ao criar agendamento", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Agendamento</DialogTitle>
          <DialogDescription>Preencha os dados para criar um agendamento.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="rounded-md bg-destructive/10 p-3 space-y-1">
              {validationErrors.map((e, i) => (
                <p key={i} className="text-sm text-destructive">{e}</p>
              ))}
            </div>
          )}

          {/* Overlap warning */}
          {overlapWarning && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-destructive">Conflito de Horário</p>
                  <p className="text-xs text-destructive/80">{overlapWarning}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Return rule warning */}
          {returnWarning && (
            <Card className="border-warning/30 bg-warning/5">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-warning">Regra de 30 Dias</p>
                    <p className="text-xs text-warning/80">{returnWarning}</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={returnOverrideConfirmed}
                    onChange={(e) => setReturnOverrideConfirmed(e.target.checked)}
                    className="rounded border-warning"
                  />
                  <span className="text-xs text-warning font-medium">
                    Confirmo o agendamento fora do prazo (será registrado como override)
                  </span>
                </label>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            <Label htmlFor="appointment-patient-search">Paciente *</Label>
            <Input
              id="appointment-patient-search"
              aria-label="Buscar paciente para agendamento"
              placeholder="Buscar por nome, CPF ou telefone..."
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
            />
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger aria-label="Selecionar paciente">
                <SelectValue placeholder={patientSearchLoading ? "Buscando..." : "Selecione o paciente"} />
              </SelectTrigger>
              <SelectContent>
                {patientOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}{p.cpf ? ` — ${p.cpf}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Especialidade</Label>
              <Select value={specialtyId} onValueChange={(v) => { setSpecialtyId(v); setProfessionalId(""); }}>
                <SelectTrigger aria-label="Selecionar especialidade"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {specialties.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo de Atendimento</Label>
              <Select value={appointmentTypeId} onValueChange={(v) => { setAppointmentTypeId(v); if (startTime) handleStartTimeChange(startTime); }}>
                <SelectTrigger aria-label="Selecionar tipo de atendimento"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {appointmentTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.default_duration_minutes || 30}min)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Profissional da unidade *</Label>
            <Select value={professionalId} onValueChange={setProfessionalId}>
              <SelectTrigger
                aria-label="Selecionar profissional da unidade ativa"
                disabled={!activeUnitId || unitProfessionalsLoading || Boolean(unitProfessionalsError)}
              >
                <SelectValue
                  placeholder={
                    unitProfessionalsLoading
                      ? "Carregando profissionais..."
                      : activeProfessionals.length > 0
                        ? "Selecione"
                        : "Nenhum profissional habilitado"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {activeProfessionals.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name} — {p.category}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {unitProfessionalsError && (
              <div className="flex items-center justify-between gap-2" role="alert">
                <p className="text-xs text-destructive">{unitProfessionalsError}</p>
                {activeUnitId && (
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadUnitProfessionals()}>
                    Recarregar
                  </Button>
                )}
              </div>
            )}
            {!unitProfessionalsLoading && !unitProfessionalsError && activeUnitId && activeProfessionals.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nenhum profissional possui agenda habilitada nesta unidade.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Serviço/procedimento</Label>
              <Input value={serviceSearch} onChange={(e) => setServiceSearch(e.target.value)} placeholder="Filtrar serviço" />
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">Não informado</SelectItem>{services.filter((s) => s.lg_ativo !== false && (!serviceSearch.trim() || s.name.toLowerCase().includes(serviceSearch.trim().toLowerCase()) || (s.code || "").toLowerCase().includes(serviceSearch.trim().toLowerCase()))).slice(0, 100).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Convênio</Label>
              <Select value={insuranceId} onValueChange={setInsuranceId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="private">Particular</SelectItem>{insurances.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {insuranceId !== "private" && <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><div className="space-y-2"><Label>Carteirinha/matrícula</Label><Input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} /></div><div className="space-y-2"><Label>Autorização</Label><Input value={authorizationNumber} onChange={(e) => setAuthorizationNumber(e.target.value)} placeholder={requirements?.requires_authorization ? "Obrigatória ou ficará pendente" : "Não obrigatória"} /></div></div>}

          {requirements && (requirements.preparation || requirements.requires_authorization || requirements.requires_eligibility || requirements.errors.length > 0) && <Card className={requirements.errors.length ? "border-destructive/40" : "border-warning/30"}><CardContent className="p-3 space-y-1"><p className="text-sm font-medium">Requisitos do agendamento</p>{requirements.requires_authorization && <p className="text-xs">Autorização do convênio necessária.</p>}{requirements.requires_eligibility && <p className="text-xs">Elegibilidade da carteirinha ficará pendente de validação.</p>}{requirements.preparation && <p className="text-xs"><strong>Preparo:</strong> {requirements.preparation}</p>}{requirements.errors.map((error) => <p key={error} className="text-xs text-destructive">{error}</p>)}</CardContent></Card>}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="appointment-date">Data *</Label>
              <Input id="appointment-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appointment-start-time">Início *</Label>
              <Input id="appointment-start-time" type="time" value={startTime} onChange={(e) => handleStartTimeChange(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appointment-end-time">Fim</Label>
              <Input id="appointment-end-time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="appointment-notes">Observações</Label>
            <Textarea id="appointment-notes" placeholder="Notas adicionais..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          <Button
            onClick={handleSubmit}
            disabled={
              saving
              || unitProfessionalsLoading
              || !activeUnitId
              || !!unitProfessionalsError
              || !!overlapWarning
              || Boolean(requirements?.errors.length)
            }
          >
            {saving ? "Salvando..." : "Agendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

