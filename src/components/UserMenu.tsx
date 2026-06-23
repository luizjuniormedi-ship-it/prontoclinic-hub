import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface UserMenuProps {
  fullName: string | null | undefined;
  roleName: string | null | undefined;
  onLogout: () => void;
}

export function UserMenu({ fullName, roleName, onLogout }: UserMenuProps) {
  const initials = fullName
    ? fullName
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  const label = `Menu do usuário, ${fullName ?? "convidado"}`;

  return (
    <>
      <div className="flex items-center gap-2 ml-2" aria-label={label}>
        <Avatar className="h-7 w-7" aria-hidden="true">
          <AvatarFallback className="text-xs bg-primary/10 text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="hidden md:block text-xs">
          <p className="font-medium text-foreground leading-tight">{fullName}</p>
          {roleName && (
            <p className="text-muted-foreground leading-tight">{roleName}</p>
          )}
        </div>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={onLogout}
            aria-label="Sair da conta"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Sair</TooltipContent>
      </Tooltip>
    </>
  );
}
