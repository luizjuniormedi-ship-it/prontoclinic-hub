import { HelpCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UserMenuProps {
  fullName: string | null | undefined;
  roleName: string | null | undefined;
  onOpenHelp: () => void;
  onLogout: () => void;
}

export function UserMenu({ fullName, roleName, onOpenHelp, onLogout }: UserMenuProps) {
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2" aria-label={label}>
          <Avatar className="h-7 w-7" aria-hidden="true">
            <AvatarFallback className="bg-primary/10 text-xs text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 text-left text-xs lg:block">
            <span className="block max-w-36 truncate font-medium leading-tight text-foreground">
              {fullName ?? "Usuário"}
            </span>
            {roleName && <span className="block truncate leading-tight text-muted-foreground">{roleName}</span>}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block truncate">{fullName ?? "Usuário"}</span>
          {roleName && <span className="block text-xs font-normal text-muted-foreground">{roleName}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenHelp}>
          <HelpCircle className="mr-2 h-4 w-4" aria-hidden="true" />
          Ajuda e atalhos
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={onLogout}
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Sair da conta
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
