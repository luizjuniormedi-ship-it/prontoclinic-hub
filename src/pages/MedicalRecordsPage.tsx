import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Users, User, AlertTriangle, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, LoadingState } from "@/components/StateViews";
import { api } from "@/services/api";
import { Patient, MedicalRecord, Appointment } from "@/types";
import { calculateAge, formatDate } from "@/utils/formatters";

export default function MedicalRecordsPage() {
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [records, setRecords] = useState<Record<string, MedicalRecord[]>>({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api.getPatients(), api.getAppointments()]).then(async ([p, a]) => {
      setPatients(p);
      setAppointments(a);
      // Load records for each patient
      const recordMap: Record<string, MedicalRecord[]> = {};
      await Promise.all(p.map(async (pat) => {
        const recs = await api.getMedicalRecords(pat.id);
        if (recs.length > 0) recordMap[pat.id] = recs;
      }));
      setRecords(recordMap);
      setLoading(false);
    });
  }, []);

  const filtered = patients.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) || p.cpf.includes(search) || p.phone.includes(search)
  );

  const getLastAppointment = (patientId: string) => {
    return appointments
      .filter((a) => a.patientId === patientId && a.status === "completed")
      .sort((a, b) => b.date.localeCompare(a.date))[0];
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Prontuário Eletrônico" description="Selecione um paciente para acessar o prontuário" />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome, CPF ou telefone..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum paciente encontrado" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const lastApp = getLastAppointment(p.id);
            const patRecords = records[p.id] || [];
            const age = calculateAge(p.birthDate);

            return (
              <Card key={p.id} className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all" onClick={() => navigate(`/patients/${p.id}`)}>
                <CardContent className="p-4 space-y-2">
                  {/* Patient header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{age}a • {p.gender === "M" ? "Masc." : "Fem."} • {p.healthInsurance || "Particular"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Alerts */}
                  {p.allergies && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-destructive/10 w-fit">
                      <AlertTriangle className="h-2.5 w-2.5 text-destructive" />
                      <span className="text-[10px] text-destructive font-medium">{p.allergies}</span>
                    </div>
                  )}

                  {/* Timeline info */}
                  <div className="border-t pt-2 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Registros: {patRecords.length}</span>
                      {patRecords.length > 0 && (
                        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-0">
                          {patRecords.length} {patRecords.length === 1 ? "registro" : "registros"}
                        </Badge>
                      )}
                    </div>
                    {lastApp && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>Última: {formatDate(lastApp.date)} — {lastApp.specialty || lastApp.doctorName}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
