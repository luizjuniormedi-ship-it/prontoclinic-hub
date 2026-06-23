import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NotificationBellProps {
  /** Number of unread notifications; badge is hidden when 0. */
  count: number;
}

export function NotificationBell({ count }: NotificationBellProps) {
  const label = `${count} notificações não lidas`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground"
          aria-label={label}
          aria-describedby="notifications-count"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {count > 0 && (
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
      </TooltipTrigger>
      <TooltipContent>Notificações</TooltipContent>
    </Tooltip>
  );
}
