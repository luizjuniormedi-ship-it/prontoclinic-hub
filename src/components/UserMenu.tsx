import { LogOut, ShieldCheck, UserRound } from "lucide-react";
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
  onOpenSecurity: () => void;
  onLogout: () => void;
}

export function UserMenu({ fullName, roleName, onOpenSecurity, onLogout }: UserMenuProps) {
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
        <Button variant="ghost" className="h-9 gap-2 px-2" aria-label="Abrir menu da conta">
          <Avatar className="h-7 w-7" aria-hidden="true">
            <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden text-left text-xs md:block">
            <span className="block font-medium leading-tight">{fullName}</span>
            {roleName && <span className="block text-muted-foreground leading-tight">{roleName}</span>}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <UserRound className="h-4 w-4" aria-hidden="true" />
          <span>{label}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenSecurity}>
          <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
          Segurança e sessões
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Sair da conta
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
