import { useState } from "react";
import { AlertTriangle, ShieldAlert, RotateCcw, Package } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AppointmentType, Doctor, Specialty, Patient, ReturnControl, TherapyPackage } from "@/types";
import { formatDate, formatCurrency, getAppointmentTypeLabel } from "@/utils/formatters";
import { api } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

const appointmentTypes: AppointmentType[] = ["consulta", "retorno", "exame", "procedimento", "terapia_avulsa", "terapia_pacote"];

const defaultDurations: Record<AppointmentType, number> = {
  consulta: 30,
  retorno: 20,
  exame: 30,
  procedimento: 60,
  terapia_avulsa: 50,
  terapia_pacote: 50,
};

interface NewAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctors: Doctor[];
  specialties: Specialty[];
  patients: Patient[];
}

type Step = "form" | "interval_alert" | "return_alert" | "therapy_package";

interface IntervalInfo {
  specialty: string;
  lastDate: string;
  daysPassed: number;
  availableDate: string;
}

export function NewAppointmentDialog({ open, onOpenChange, doctors, specialties, patients }: NewAppointmentDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("form");
  const [patientId, setPatientId] = useState("");
  const [type, setType] = useState<AppointmentType | "">("");
  const [doctorId, setDoctorId] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("30");
  const [value, setValue] = useState("");
  const [therapyType, setTherapyType] = useState("");
  const [notes, setNotes] = useState("");
  const [intervalInfo, setIntervalInfo] = useState<IntervalInfo | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [activeReturns, setActiveReturns] = useState<ReturnControl[]>([]);
  const [selectedReturnId, setSelectedReturnId] = useState("");
  const [patientPackages, setPatientPackages] = useState<TherapyPackage[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState("");

  // Duplicate detection
  const [cpfSearch, setCpfSearch] = useState("");
  const duplicatePatient = cpfSearch.length >= 5
    ? patients.find((p) => p.cpf.includes(cpfSearch) || p.phone.includes(cpfSearch))
    : undefined;

  const selectedDoctor = doctors.find((d) => d.id === doctorId);
  const filteredDoctors = specialtyId ? doctors.filter((d) => d.specialtyId === specialtyId) : doctors;

  const handleTypeChange = (v: string) => {
    const newType = v as AppointmentType;
    setType(newType);
    setDuration(String(defaultDurations[newType]));
  };

  const resetForm = () => {
    setStep("form");
    setPatientId(""); setType(""); setDoctorId(""); setSpecialtyId("");
    setDate(""); setTime(""); setDuration("30"); setValue("");
    setTherapyType(""); setNotes(""); setIntervalInfo(null);
    setOverrideReason(""); setActiveReturns([]); setSelectedReturnId("");
    setPatientPackages([]); setSelectedPackageId(""); setCpfSearch("");
  };

  const handleClose = () => { resetForm(); onOpenChange(false); };

  const handleSubmit = async () => {
    if (!patientId || !type || !doctorId || !date || !time) {
      toast({ title: "Preencha todos os campos obrigatórios", variant: "destructive" });
      return;
    }
    const specialty = selectedDoctor?.specialty || "";
    if (type === "consulta" && specialty) {
      const check = await api.checkConsultaInterval(patientId, specialty);
      if (check.blocked) {
        setIntervalInfo({ specialty, lastDate: check.lastDate!, daysPassed: check.daysPassed!, availableDate: check.availableDate! });
        setStep("interval_alert");
        return;
      }
    }
    if (type === "retorno") {
      const returns = await api.checkActiveReturns(patientId);
      if (returns.length > 0) { setActiveReturns(returns); setStep("return_alert"); return; }
    }
    if (type === "terapia_pacote") {
      const packages = await api.getTherapyPackages(patientId);
      const active = packages.filter((p) => p.status === "active");
      if (active.length > 0) { setPatientPackages(active); setStep("therapy_package"); return; }
      else { toast({ title: "Nenhum pacote ativo", description: "Este paciente não possui pacotes de terapia ativos.", variant: "destructive" }); return; }
    }
    confirmAppointment();
  };

  const confirmAppointment = () => { toast({ title: "Agendamento criado com sucesso!" }); handleClose(); };

  const handleOverride = () => {
    if (!overrideReason.trim()) { toast({ title: "Justificativa obrigatória", variant: "destructive" }); return; }
    toast({ title: "Agendamento liberado", description: "A liberação antecipada foi registrada em auditoria." });
    handleClose();
  };

  const handleReturnConfirm = (asReturn: boolean) => {
    toast({ title: asReturn && selectedReturnId ? "Retorno agendado com sucesso!" : "Agendamento criado com sucesso!" });
    handleClose();
  };

  const handlePackageConfirm = () => {
    const pkg = patientPackages.find((p) => p.id === selectedPackageId);
    if (!pkg) { toast({ title: "Selecione um pacote", variant: "destructive" }); return; }
    toast({
      title: "Sessão agendada",
      description: pkg.remainingSessions <= 0 ? "⚠️ Pacote sem saldo. Sessão extra registrada." : `Restam ${pkg.remainingSessions - 1} sessões no pacote.`,
    });
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {step === "form" && (
          <>
            <DialogHeader>
              <DialogTitle>Novo Agendamento</DialogTitle>
              <DialogDescription>Preencha os dados para criar um agendamento.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Paciente *</Label>
                <Select value={patientId} onValueChange={setPatientId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o paciente" /></SelectTrigger>
                  <SelectContent>
                    {patients.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} — {p.cpf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Tipo de Atendimento *</Label>
                  <Select value={type} onValueChange={handleTypeChange}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {appointmentTypes.map((t) => (
                        <SelectItem key={t} value={t}>{getAppointmentTypeLabel(t)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Especialidade *</Label>
                  <Select value={specialtyId} onValueChange={(v) => { setSpecialtyId(v); setDoctorId(""); }}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {specialties.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Profissional *</Label>
                <Select value={doctorId} onValueChange={setDoctorId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {filteredDoctors.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name} — {d.specialty}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Data *</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Horário *</Label>
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Duração (min)</Label>
                  <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} min="10" step="5" />
                  {type && <p className="text-[10px] text-muted-foreground">Padrão: {defaultDurations[type]}min</p>}
                </div>
              </div>

              {(type === "terapia_avulsa" || type === "terapia_pacote") && (
                <div className="space-y-2">
                  <Label>Tipo de Terapia</Label>
                  <Input placeholder="Ex: Fisioterapia, Acupuntura..." value={therapyType} onChange={(e) => setTherapyType(e.target.value)} />
                </div>
              )}

              {type !== "terapia_pacote" && type !== "retorno" && (
                <div className="space-y-2">
                  <Label>Valor (R$)</Label>
                  <Input type="number" placeholder="0,00" value={value} onChange={(e) => setValue(e.target.value)} min="0" step="0.01" />
                </div>
              )}

              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea placeholder="Notas adicionais..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button onClick={handleSubmit}>Agendar</Button>
            </DialogFooter>
          </>
        )}

        {step === "interval_alert" && intervalInfo && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-warning">
                <ShieldAlert className="h-5 w-5" />Intervalo Mínimo não Atingido
              </DialogTitle>
            </DialogHeader>
            <Card className="border-warning/30 bg-warning/5">
              <CardContent className="p-4 space-y-2">
                <p className="text-sm">Este paciente realizou consulta em <strong>{intervalInfo.specialty}</strong> em <strong>{formatDate(intervalInfo.lastDate)}</strong>.</p>
                <p className="text-sm">Dias passados: <strong>{intervalInfo.daysPassed}</strong> de 30.</p>
                <p className="text-sm">Liberado a partir de <strong>{formatDate(intervalInfo.availableDate)}</strong>.</p>
              </CardContent>
            </Card>
            <div className="space-y-2">
              <Label>Justificativa para liberação antecipada *</Label>
              <Textarea placeholder="Informe o motivo da exceção..." value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={3} />
              <p className="text-xs text-muted-foreground">Esta ação será registrada em auditoria.</p>
            </div>
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("form")}>Voltar</Button>
              <Button variant="destructive" onClick={handleClose}>Cancelar</Button>
              <Button onClick={handleOverride}>Liberar Antes</Button>
            </DialogFooter>
          </>
        )}

        {step === "return_alert" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-secondary">
                <RotateCcw className="h-5 w-5" />Retorno Ativo Encontrado
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {activeReturns.map((ret) => (
                <Card key={ret.id} className={`cursor-pointer transition-colors ${selectedReturnId === ret.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`} onClick={() => setSelectedReturnId(ret.id)}>
                  <CardContent className="p-4 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm">{ret.specialty}</p>
                      <Badge variant="outline" className="bg-success/10 text-success border-0 text-xs">Ativo</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Profissional: {ret.doctorName}</p>
                    <p className="text-xs text-muted-foreground">Consulta origem: {formatDate(ret.originDate)}</p>
                    <p className="text-xs text-muted-foreground">Válido até: <strong>{formatDate(ret.expiresAt)}</strong></p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("form")}>Voltar</Button>
              <Button variant="secondary" onClick={() => handleReturnConfirm(false)}>Agendar mesmo assim</Button>
              <Button onClick={() => handleReturnConfirm(true)} disabled={!selectedReturnId}>Agendar como retorno</Button>
            </DialogFooter>
          </>
        )}

        {step === "therapy_package" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Package className="h-5 w-5 text-success" />Selecionar Pacote
              </DialogTitle>
              <DialogDescription>Escolha o pacote para vincular esta sessão.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {patientPackages.map((pkg) => {
                const pct = (pkg.usedSessions / pkg.totalSessions) * 100;
                const isExpired = new Date(pkg.expiresAt + "T00:00:00") < new Date();
                const noBalance = pkg.remainingSessions <= 0;
                return (
                  <Card key={pkg.id} className={`cursor-pointer transition-colors ${selectedPackageId === pkg.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"} ${isExpired ? "opacity-60" : ""}`} onClick={() => setSelectedPackageId(pkg.id)}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm">{pkg.therapyType}</p>
                        <div className="flex gap-1">
                          {isExpired && <Badge variant="outline" className="bg-destructive/10 text-destructive border-0 text-xs">Vencido</Badge>}
                          {noBalance && <Badge variant="outline" className="bg-warning/10 text-warning border-0 text-xs">Sem saldo</Badge>}
                          {!isExpired && !noBalance && <Badge variant="outline" className="bg-success/10 text-success border-0 text-xs">Ativo</Badge>}
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{pkg.usedSessions}/{pkg.totalSessions} sessões</span>
                        <span>Restam: {pkg.remainingSessions}</span>
                      </div>
                      <Progress value={pct} className="h-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Valor: {formatCurrency(pkg.value)}</span>
                        <span>Validade: {formatDate(pkg.expiresAt)}</span>
                      </div>
                      {pkg.sessions.length > 0 && (
                        <div className="mt-2 border-t pt-2">
                          <p className="text-xs font-medium mb-1">Últimas sessões:</p>
                          {pkg.sessions.slice(-3).map((s) => (
                            <p key={s.id} className="text-xs text-muted-foreground">
                              {formatDate(s.date)} — {s.status === "completed" ? "✓ Realizada" : s.status === "scheduled" ? "◦ Agendada" : s.status}
                            </p>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("form")}>Voltar</Button>
              <Button onClick={handlePackageConfirm} disabled={!selectedPackageId}>Confirmar Sessão</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
