import { useState } from "react";
import { Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AppointmentStatus, AppointmentType } from "@/types";
import { getAppointmentStatusLabel, getAppointmentTypeLabel } from "@/utils/formatters";

const allStatuses: AppointmentStatus[] = ["scheduled", "confirmed", "waiting", "in_progress", "completed", "no_show", "cancelled"];
const allTypes: AppointmentType[] = ["consulta", "retorno", "exame", "procedimento", "terapia_avulsa", "terapia_pacote"];

interface FilterDoctor { id: string; name: string; }
interface FilterSpecialty { id: string; name: string; }

interface ScheduleFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  doctorFilter: string;
  onDoctorFilter: (v: string) => void;
  specialtyFilter: string;
  onSpecialtyFilter: (v: string) => void;
  typeFilter: string;
  onTypeFilter: (v: string) => void;
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  doctors: FilterDoctor[];
  specialties: FilterSpecialty[];
  onClearFilters: () => void;
  hasFilters: boolean;
}

export function ScheduleFilters({
  search, onSearchChange,
  doctorFilter, onDoctorFilter,
  specialtyFilter, onSpecialtyFilter,
  typeFilter, onTypeFilter,
  statusFilter, onStatusFilter,
  doctors, specialties,
  onClearFilters, hasFilters,
}: ScheduleFiltersProps) {
  const [showFilters, setShowFilters] = useState(true);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, CPF ou telefone..." value={search} onChange={(e) => onSearchChange(e.target.value)} className="pl-10" />
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="h-4 w-4 mr-1" />Filtros
        </Button>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={onClearFilters} className="text-destructive">Limpar</Button>
        )}
      </div>
      {showFilters && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 animate-fade-in">
          <Select value={doctorFilter} onValueChange={onDoctorFilter}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Profissional" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={specialtyFilter} onValueChange={onSpecialtyFilter}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Especialidade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {specialties.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={onTypeFilter}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {allTypes.map((t) => <SelectItem key={t} value={t}>{getAppointmentTypeLabel(t)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={onStatusFilter}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {allStatuses.map((s) => <SelectItem key={s} value={s}>{getAppointmentStatusLabel(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
