import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NotificationBellProps {
  /** Number of unread notifications; omit it when the personal feed is unavailable. */
  count?: number;
  onOpenCenter?: () => void;
}

export function NotificationBell({ count, onOpenCenter }: NotificationBellProps) {
  const hasKnownCount = typeof count === "number";
  const label = count && count > 0 ? `${count} notificações não lidas` : "Notificações";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground"
          aria-label={label}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {count !== undefined && count > 0 && (
            <>
              <span
                className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive"
                aria-hidden="true"
              />
              <span id="notifications-count" className="sr-only">
                {label}
              </span>
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Notificações</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          {count !== undefined && count > 0
            ? `${count} item(ns) aguardam leitura na Central de notificações.`
            : hasKnownCount
              ? "Nenhuma notificação nova nesta sessão."
              : "O feed pessoal de notificações ainda não está conectado."}
        </DropdownMenuItem>
        {onOpenCenter && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenCenter}>Abrir Central de notificações</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
