import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  Clock,
  RefreshCw,
  Search,
  Stethoscope,
  UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ExplainedActionButton } from "@/components/actions/ExplainedActionButton";
import {
  ReceptionCheckinDialog,
  type ReceptionPatientContext,
} from "@/components/reception/ReceptionCheckinDialog";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { AppointmentStatusBadge, AppointmentTypeBadge } from "@/components/StatusBadge";
import {
  appointmentsService,
  professionalsLookup,
  specialtiesLookup,
  appointmentTypesLookup,
  type DbAppointment,
  type DbAppointmentType,
  type DbProfessional,
  type DbSpecialty,
} from "@/services/appointmentsService";
import {
  receptionService,
  type CheckinReadiness,
  type ReceptionPendingItem,
} from "@/services/receptionService";
import { supabase } from "@/lib/supabase";
import { type Appointment, type AppointmentStatus } from "@/types";
import type { AppointmentStatusForBadge, AppointmentTypeLiteral } from "@/types/missing";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccessRole } from "@/hooks/useActiveAccessRole";
import { calculateAge } from "@/utils/formatters";
import { useDebounce } from "@/hooks/useDebounce";
import { canAccessRoute, normalizeRoleName } from "@/config/routePermissions";

interface PatientRow extends ReceptionPatientContext {
  phone: string | null;
  insurance_plan_id: string | null;
}

type ReceptionTab = "arrivals" | "waiting" | "pending" | "attending" | "done";

const pendingKindLabels: Record<ReceptionPendingItem["kind"], string> = {
  authorization: "Autorização",
  eligibility: "Elegibilidade",
};

const pendingStatusLabels: Record<string, string> = {
  pendente: "Pendente",
  solicitada: "Solicitada",
  em_analise: "Em análise",
  autorizada: "Autorizada",
  parcialmente_autorizada: "Parcialmente autorizada",
  negada: "Negada",
  reenviada: "Reenviada",
  liberada_excecao: "Liberada por exceção",
  elegivel: "Elegível",
  nao_elegivel: "Não elegível",
  portal_indisponivel: "Portal indisponível",
  nao_obrigatoria: "Não obrigatória",
  liberado_excecao: "Liberada por exceção",
};

function toDisplayAppointment(
  db: DbAppointment,
  patients: PatientRow[],
  professionals: DbProfessional[],
  specialties: DbSpecialty[],
  appointmentTypes: DbAppointmentType[],
): Appointment {
  const patient = patients.find((entry) => entry.id === String(db.patient_id));
  const professional = professionals.find((entry) => entry.id === String(db.professional_id));
  const specialty = specialties.find((entry) => entry.id === String(db.specialty_id));
  const appointmentType = appointmentTypes.find((entry) => entry.id === String(db.appointment_type_id));

  let duration = 30;
  if (db.start_time && db.end_time) {
    const [startHour, startMinute] = db.start_time.split(":").map(Number);
    const [endHour, endMinute] = db.end_time.split(":").map(Number);
    duration = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
    if (duration <= 0) duration = 30;
  }

  const category = appointmentType?.category || "consulta";
  const validTypes = ["consulta", "retorno", "exame", "procedimento", "terapia_avulsa", "terapia_pacote"];

  return {
    id: String(db.id),
    patientId: db.patient_id ? String(db.patient_id) : "",
    patientName: patient?.full_name || "Paciente não encontrado",
    patientCpf: patient?.cpf || undefined,
    patientPhone: patient?.phone || undefined,
    doctorId: db.professional_id ? String(db.professional_id) : "",
    doctorName: professional?.full_name || "—",
    specialty: specialty?.name,
    unitId: db.unit_id ? String(db.unit_id) : undefined,
    insuranceCompanyId: db.insurance_company_id ? String(db.insurance_company_id) : undefined,
    date: db.appointment_date,
    time: db.start_time?.substring(0, 5) || "00:00",
    duration,
    status: (db.status as AppointmentStatus) || "scheduled",
    type: (validTypes.includes(category) ? category : "consulta") as AppointmentTypeLiteral,
    typeLabel: appointmentType?.name,
    serviceName: db.service_name || undefined,
    notes: db.notes || undefined,
  };
}

function receptionDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function ReceptionPage() {
  const [dbAppointments, setDbAppointments] = useState<DbAppointment[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [specialties, setSpecialties] = useState<DbSpecialty[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<DbAppointmentType[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<ReceptionTab>("arrivals");
  const [checkinTarget, setCheckinTarget] = useState<Appointment | null>(null);
  const [readiness, setReadiness] = useState<CheckinReadiness | null>(null);
  const [priority, setPriority] = useState<"normal" | "legal" | "urgent">("normal");
  const [exceptionReason, setExceptionReason] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [pendingItems, setPendingItems] = useState<ReceptionPendingItem[]>([]);
  const [pendingTarget, setPendingTarget] = useState<ReceptionPendingItem | null>(null);
  const [pendingStatus, setPendingStatus] = useState("");
  const [pendingProtocol, setPendingProtocol] = useState("");
  const [authorizationNumber, setAuthorizationNumber] = useState("");
  const [authorizationPassword, setAuthorizationPassword] = useState("");
  const [authorizationValidUntil, setAuthorizationValidUntil] = useState("");
  const [pendingDetail, setPendingDetail] = useState("");

  const debouncedSearch = useDebounce(search, 300);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const today = receptionDateKey();
  const roleName = useActiveAccessRole(user?.role_name);
  const normalizedRole = normalizeRoleName(roleName);
  const rawRole = roleName?.trim().toLowerCase() || "";
  const canReleaseException = normalizedRole === "admin"
    || normalizedRole === "gestor"
    || ["supervisor", "supervisor_recepcao", "diretoria"].includes(rawRole);
  const canOpenAttendance = canAccessRoute(roleName, "/attendance");

  const loadAll = useCallback(async (silent = false) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const [professionalRows, specialtyRows, typeRows, appointmentRows, pendingRows] = await Promise.all([
        professionalsLookup.getAll(),
        specialtiesLookup.getAll(),
        appointmentTypesLookup.getAll(),
        appointmentsService.getByDate(today),
        receptionService.listPending(),
      ]);

      const patientIds = [...new Set(appointmentRows.map((appointment) => appointment.patient_id).filter(Boolean))];
      let patientRows: PatientRow[] = [];
      if (patientIds.length > 0) {
        const { data, error: patientError } = await supabase
          .from("patients")
          .select("id, full_name, cpf, birth_date, phone, allergies, insurance_plan_id")
          .in("id", patientIds);
        if (patientError) throw patientError;
        patientRows = (data || []).map((patient) => ({
          ...patient,
          id: String(patient.id),
          insurance_plan_id: patient.insurance_plan_id ? String(patient.insurance_plan_id) : null,
        })) as PatientRow[];
      }

      setProfessionals(professionalRows);
      setSpecialties(specialtyRows);
      setAppointmentTypes(typeRows);
      setPatients(patientRows);
      setDbAppointments(appointmentRows);
      setPendingItems(pendingRows);
    } catch (loadError) {
      setError((loadError as Error).message || "Erro ao carregar recepção");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [today]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const appointments = useMemo(
    () => dbAppointments.map((appointment) => toDisplayAppointment(
      appointment,
      patients,
      professionals,
      specialties,
      appointmentTypes,
    )),
    [dbAppointments, patients, professionals, specialties, appointmentTypes],
  );

  const sorted = useMemo(
    () => [...appointments].sort((first, second) => first.time.localeCompare(second.time)),
    [appointments],
  );

  const filtered = useMemo(() => sorted.filter((appointment) => {
    if (!debouncedSearch.trim()) return true;
    const query = debouncedSearch.toLowerCase();
    const digits = query.replace(/\D/g, "");
    return appointment.patientName.toLowerCase().includes(query)
      || appointment.doctorName.toLowerCase().includes(query)
      || Boolean(digits && appointment.patientCpf?.includes(digits));
  }), [sorted, debouncedSearch]);

  const arrivals = filtered.filter((appointment) => appointment.status === "scheduled" || appointment.status === "confirmed");
  const waiting = filtered.filter((appointment) => appointment.status === "waiting");
  const attending = filtered.filter((appointment) => appointment.status === "in_progress");
  const done = filtered.filter((appointment) => appointment.status === "completed");

  const getPatient = (patientId: string) => patients.find((patient) => patient.id === patientId);

  const isLate = (appointment: Appointment) => {
    const now = new Date();
    const [hour, minute] = appointment.time.split(":").map(Number);
    const scheduledAt = new Date();
    scheduledAt.setHours(hour, minute, 0, 0);
    return now > scheduledAt && (appointment.status === "scheduled" || appointment.status === "confirmed");
  };

  const openCheckin = async (appointment: Appointment) => {
    try {
      setCheckingIn(true);
      setCheckinTarget(appointment);
      setReadiness(null);
      setExceptionReason("");
      setPriority("normal");
      setReadiness(await receptionService.getReadiness(appointment.id));
    } catch (readinessError) {
      setCheckinTarget(null);
      toast({
        title: "Erro ao validar check-in",
        description: (readinessError as Error).message,
        variant: "destructive",
      });
    } finally {
      setCheckingIn(false);
    }
  };

  const closeCheckin = () => {
    if (checkingIn) return;
    setCheckinTarget(null);
    setReadiness(null);
    setExceptionReason("");
  };

  const refreshCheckinReadiness = useCallback(async () => {
    if (!checkinTarget) return;
    const nextReadiness = await receptionService.getReadiness(checkinTarget.id);
    setReadiness(nextReadiness);
  }, [checkinTarget]);

  const confirmCheckin = async () => {
    if (!checkinTarget || !readiness) return;
    if (!readiness.ready && !exceptionReason.trim()) {
      toast({ title: "Informe a justificativa da exceção", variant: "destructive" });
      return;
    }

    try {
      setCheckingIn(true);
      const result = await receptionService.checkin(
        checkinTarget.id,
        priority,
        readiness.ready ? undefined : exceptionReason,
      );
      toast({
        title: `Check-in concluído · Senha ${result.ticket}`,
        description: result.released_by_exception
          ? "A liberação por exceção foi registrada para auditoria."
          : "O paciente foi encaminhado para a fila correta.",
      });
      closeCheckin();
      setActiveTab("waiting");
      await loadAll(true);
    } catch (checkinError) {
      toast({
        title: "Check-in bloqueado",
        description: (checkinError as Error).message,
        variant: "destructive",
      });
    } finally {
      setCheckingIn(false);
    }
  };

  const openPending = (item: ReceptionPendingItem) => {
    setPendingTarget(item);
    setPendingStatus(item.status);
    setPendingProtocol(item.protocol_number || "");
    setAuthorizationNumber("");
    setAuthorizationPassword("");
    setAuthorizationValidUntil("");
    setPendingDetail(item.description || "");
  };

  const resolveIssueFromCheckin = (type: string) => {
    if (!checkinTarget) return;
    const expectedKind = type === "authorization" ? "authorization" : "eligibility";
    const item = pendingItems.find((pending) => (
      pending.kind === expectedKind && String(pending.appointment_id) === checkinTarget.id
    ));

    if (!item) {
      toast({
        title: "Pendência não localizada",
        description: "Abra a aba Pendências para consultar ou registrar a atualização administrativa.",
        variant: "destructive",
      });
      setActiveTab("pending");
      return;
    }

    closeCheckin();
    setActiveTab("pending");
    openPending(item);
  };

  const savePending = async () => {
    if (!pendingTarget || !pendingStatus) return;

    try {
      setCheckingIn(true);
      if (pendingTarget.kind === "authorization") {
        await receptionService.updateAuthorization(pendingTarget.id, {
          status: pendingStatus,
          protocol: pendingProtocol,
          authorizationNumber,
          password: authorizationPassword,
          validUntil: authorizationValidUntil,
          reason: pendingDetail,
        });
      } else {
        await receptionService.updateEligibility(pendingTarget.id, {
          status: pendingStatus,
          protocol: pendingProtocol,
          detail: pendingDetail,
        });
      }
      toast({ title: "Pendência atualizada e auditada" });
      setPendingTarget(null);
      await loadAll(true);
    } catch (pendingError) {
      toast({
        title: "Erro ao atualizar pendência",
        description: (pendingError as Error).message,
        variant: "destructive",
      });
    } finally {
      setCheckingIn(false);
    }
  };

  const openAttendance = async (appointment: Appointment) => {
    try {
      await appointmentsService.updateStatus(appointment.id, "in_progress");
      navigate(`/attendance/${appointment.id}`);
    } catch (attendanceError) {
      toast({
        title: "Não foi possível iniciar o atendimento",
        description: (attendanceError as Error).message,
        variant: "destructive",
      });
    }
  };

  const renderAppointmentCard = (appointment: Appointment, actions?: React.ReactNode) => {
    const patient = getPatient(appointment.patientId);
    const late = isLate(appointment);
    const age = patient?.birth_date ? calculateAge(patient.birth_date) : null;

    return (
      <Card
        key={appointment.id}
        className={`transition-shadow hover:shadow-md ${late ? "border-l-4 border-l-destructive" : appointment.status === "waiting" ? "border-l-4 border-l-warning" : appointment.status === "in_progress" ? "border-l-4 border-l-success" : ""}`}
      >
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="min-w-[52px] text-center">
              <p className="text-sm font-bold text-primary">{appointment.time}</p>
              <p className="text-[10px] text-muted-foreground">{appointment.duration} min</p>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className="truncate text-left text-sm font-medium hover:text-primary hover:underline"
                  onClick={() => navigate(`/patients/${appointment.patientId}`)}
                  aria-label={`Abrir cadastro de ${appointment.patientName}`}
                >
                  {appointment.patientName}
                </button>
                {age != null && <span className="text-[10px] text-muted-foreground">{age}a</span>}
                {appointment.typeLabel && <AppointmentTypeBadge type={appointment.type} />}
              </div>
              <p className="text-xs text-muted-foreground">
                {appointment.doctorName}{appointment.specialty ? ` · ${appointment.specialty}` : ""}
              </p>
              {(late || patient?.allergies) && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {late && (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-destructive">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />Atrasado
                    </span>
                  )}
                  {patient?.allergies && (
                    <span className="flex items-center gap-1 text-[10px] text-destructive">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />Alergia: {patient.allergies}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
            <AppointmentStatusBadge status={appointment.status as AppointmentStatusForBadge} />
            {actions}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void loadAll()} />;

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Recepção do dia"
        description="Faça check-in, resolva pendências administrativas e acompanhe a chegada dos pacientes."
        actions={(
          <ExplainedActionButton
            label="Atualizar"
            description="Atualiza agendamentos, pendências, status e filas da recepção."
            icon={RefreshCw}
            variant="outline"
            loading={refreshing}
            loadingLabel="Atualizando..."
            onClick={() => void loadAll(true)}
          />
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatusCard icon={<Clock className="h-4 w-4" />} label="Aguardando chegada" count={arrivals.length} color="text-primary" bg="bg-primary/5 border-primary/20" />
        <StatusCard icon={<Check className="h-4 w-4" />} label="Sala de espera" count={waiting.length} color="text-warning" bg="bg-warning/5 border-warning/20" />
        <StatusCard icon={<ClipboardCheck className="h-4 w-4" />} label="Pendências" count={pendingItems.length} color="text-destructive" bg="bg-destructive/5 border-destructive/20" />
        <StatusCard icon={<Stethoscope className="h-4 w-4" />} label="Em atendimento" count={attending.length} color="text-success" bg="bg-success/5 border-success/20" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Buscar por paciente, CPF ou profissional..."
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar pacientes da recepção"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {filtered.length} de {sorted.length} agendamento(s) visível(is)
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ReceptionTab)}>
        <TabsList className="grid h-auto w-full grid-cols-2 md:grid-cols-5">
          <TabsTrigger value="arrivals">Chegadas ({arrivals.length})</TabsTrigger>
          <TabsTrigger value="waiting">Sala de espera ({waiting.length})</TabsTrigger>
          <TabsTrigger value="pending">Pendências ({pendingItems.length})</TabsTrigger>
          <TabsTrigger value="attending">Em atendimento ({attending.length})</TabsTrigger>
          <TabsTrigger value="done">Finalizados ({done.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="arrivals" className="mt-3 space-y-2">
          {arrivals.length === 0 ? (
            <EmptyState icon={UserCheck} title="Nenhum paciente aguardando chegada" description="Os próximos pacientes confirmados aparecerão aqui." />
          ) : arrivals.map((appointment) => renderAppointmentCard(
            appointment,
            <ExplainedActionButton
              label="Fazer check-in"
              description="Abre a conferência de cadastro, convênio, elegibilidade e autorização antes de gerar a senha."
              size="sm"
              variant="outline"
              onClick={() => void openCheckin(appointment)}
            />,
          ))}
        </TabsContent>

        <TabsContent value="waiting" className="mt-3 space-y-2">
          {waiting.length === 0 ? (
            <EmptyState icon={Check} title="Sala de espera vazia" description="Pacientes com check-in concluído aparecerão aqui." />
          ) : waiting.map((appointment) => renderAppointmentCard(
            appointment,
            canOpenAttendance ? (
              <ExplainedActionButton
                label="Abrir atendimento"
                description="Inicia o atendimento clínico e abre a tela assistencial deste paciente."
                size="sm"
                onClick={() => void openAttendance(appointment)}
              />
            ) : (
              <Badge variant="outline" className="text-xs">Encaminhado à fila</Badge>
            ),
          ))}
        </TabsContent>

        <TabsContent value="pending" className="mt-3 space-y-2">
          {pendingItems.length === 0 ? (
            <EmptyState icon={Check} title="Nenhuma pendência administrativa" description="Elegibilidades e autorizações que exigirem ação aparecerão aqui." />
          ) : pendingItems.map((item) => (
            <Card key={`${item.kind}-${item.id}`}>
              <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{item.patient_name || `Paciente #${item.patient_id || "-"}`}</p>
                    <Badge variant={item.status.includes("neg") || item.status === "portal_indisponivel" ? "destructive" : "outline"}>
                      {pendingKindLabels[item.kind]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Agendamento #{item.appointment_id || "-"} · {pendingStatusLabels[item.status] || item.status.replace(/_/g, " ")}
                    {item.protocol_number ? ` · Protocolo ${item.protocol_number}` : ""}
                  </p>
                  <p className="mt-1 text-xs">{item.description || "Sem observação adicional."}</p>
                </div>
                <ExplainedActionButton
                  label="Resolver"
                  description={`Abre os dados desta ${pendingKindLabels[item.kind].toLowerCase()} para registrar protocolo, status e justificativa.`}
                  size="sm"
                  variant="outline"
                  onClick={() => openPending(item)}
                />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="attending" className="mt-3 space-y-2">
          {attending.length === 0 ? (
            <EmptyState icon={Stethoscope} title="Nenhum atendimento em andamento" />
          ) : attending.map((appointment) => renderAppointmentCard(
            appointment,
            canOpenAttendance ? (
              <ExplainedActionButton
                label="Abrir atendimento"
                description="Retoma a tela clínica deste atendimento em andamento."
                size="sm"
                variant="outline"
                onClick={() => navigate(`/attendance/${appointment.id}`)}
              />
            ) : undefined,
          ))}
        </TabsContent>

        <TabsContent value="done" className="mt-3 space-y-2">
          {done.length === 0 ? (
            <EmptyState icon={UserCheck} title="Nenhum atendimento finalizado hoje" />
          ) : done.map((appointment) => renderAppointmentCard(appointment))}
        </TabsContent>
      </Tabs>

      <ReceptionCheckinDialog
        appointment={checkinTarget}
        patient={checkinTarget ? getPatient(checkinTarget.patientId) : undefined}
        readiness={readiness}
        loading={checkingIn}
        priority={priority}
        exceptionReason={exceptionReason}
        canReleaseException={canReleaseException}
        onPriorityChange={setPriority}
        onExceptionReasonChange={setExceptionReason}
        onClose={closeCheckin}
        onConfirm={() => void confirmCheckin()}
        onOpenPatient={() => {
          if (checkinTarget) navigate(`/patients/${checkinTarget.patientId}/edit`);
        }}
        onResolveIssue={resolveIssueFromCheckin}
        onCheckoutChanged={refreshCheckinReadiness}
      />

      <Dialog open={Boolean(pendingTarget)} onOpenChange={(open) => !open && !checkingIn && setPendingTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {pendingTarget?.kind === "authorization" ? "Atualizar autorização" : "Atualizar elegibilidade"}
            </DialogTitle>
            <DialogDescription>
              {pendingTarget?.patient_name} · Agendamento #{pendingTarget?.appointment_id || "-"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pending-status">Status</Label>
              <Select value={pendingStatus} onValueChange={setPendingStatus}>
                <SelectTrigger id="pending-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(pendingTarget?.kind === "authorization"
                    ? ["pendente", "solicitada", "em_analise", "autorizada", "parcialmente_autorizada", "negada", "reenviada", "liberada_excecao"]
                    : ["pendente", "em_analise", "elegivel", "nao_elegivel", "portal_indisponivel", "nao_obrigatoria", "liberado_excecao"]
                  ).map((status) => (
                    <SelectItem key={status} value={status}>{pendingStatusLabels[status] || status.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pending-protocol">Protocolo</Label>
              <Input id="pending-protocol" value={pendingProtocol} onChange={(event) => setPendingProtocol(event.target.value)} />
            </div>

            {pendingTarget?.kind === "authorization" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="authorization-number">Número da autorização</Label>
                    <Input id="authorization-number" value={authorizationNumber} onChange={(event) => setAuthorizationNumber(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="authorization-password">Senha</Label>
                    <Input id="authorization-password" value={authorizationPassword} onChange={(event) => setAuthorizationPassword(event.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="authorization-validity">Validade</Label>
                  <Input id="authorization-validity" type="date" value={authorizationValidUntil} onChange={(event) => setAuthorizationValidUntil(event.target.value)} />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="pending-detail">Detalhe ou justificativa</Label>
              <Textarea id="pending-detail" value={pendingDetail} onChange={(event) => setPendingDetail(event.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <ExplainedActionButton
              label="Cancelar"
              description="Fecha esta atualização sem alterar a pendência."
              variant="outline"
              onClick={() => setPendingTarget(null)}
              disabled={checkingIn}
            />
            <ExplainedActionButton
              label="Salvar atualização"
              description="Registra o status, protocolo e demais informações desta pendência na auditoria."
              loading={checkingIn}
              loadingLabel="Salvando..."
              disabled={!pendingStatus}
              disabledReason="Selecione o status antes de salvar."
              onClick={() => void savePending()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusCard({
  icon,
  label,
  count,
  color,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  color: string;
  bg: string;
}) {
  return (
    <Card className={bg}>
      <CardContent className="flex items-center gap-2 p-3">
        <div className={color}>{icon}</div>
        <div>
          <p className={`text-lg font-bold leading-tight ${color}`}>{count}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
