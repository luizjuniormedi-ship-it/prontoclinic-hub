import { MoreHorizontal, UserCheck, Play, Calendar, X, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Appointment } from "@/types";

interface QuickActionsMenuProps {
  appointment: Appointment;
  onAction: (action: string, appointment: Appointment) => void;
}

export function QuickActionsMenu({ appointment, onAction }: QuickActionsMenuProps) {
  const canCheckIn = appointment.status === "confirmed" || appointment.status === "scheduled";
  const canStart = appointment.status === "waiting" || appointment.status === "confirmed";
  const canReschedule = appointment.status !== "completed" && appointment.status !== "cancelled";
  const canCancel = appointment.status !== "completed" && appointment.status !== "cancelled";
  const canNoShow = appointment.status !== "completed" && appointment.status !== "cancelled" && appointment.status !== "no_show";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {canCheckIn && (
          <DropdownMenuItem onClick={() => onAction("checkin", appointment)}>
            <UserCheck className="h-4 w-4 mr-2" />Check-in
          </DropdownMenuItem>
        )}
        {canStart && (
          <DropdownMenuItem onClick={() => onAction("start", appointment)}>
            <Play className="h-4 w-4 mr-2" />Iniciar atendimento
          </DropdownMenuItem>
        )}
        {canReschedule && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onAction("reschedule", appointment)}>
              <Calendar className="h-4 w-4 mr-2" />Remarcar
            </DropdownMenuItem>
          </>
        )}
        {canNoShow && (
          <DropdownMenuItem onClick={() => onAction("no_show", appointment)} className="text-warning">
            <UserX className="h-4 w-4 mr-2" />Registrar falta
          </DropdownMenuItem>
        )}
        {canCancel && (
          <DropdownMenuItem onClick={() => onAction("cancel", appointment)} className="text-destructive">
            <X className="h-4 w-4 mr-2" />Cancelar
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
