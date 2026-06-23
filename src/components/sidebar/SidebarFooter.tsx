import { LogOut } from "lucide-react";
import {
  SidebarFooter as UiSidebarFooter,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/utils/formatters";

type AuthUser = {
  full_name: string;
  email: string;
};

export function SidebarFooter({
  user, collapsed, onLogout,
}: { user: AuthUser | null | undefined; collapsed: boolean; onLogout: () => void }) {
  if (!user) return null;
  return (
    <UiSidebarFooter className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-2">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
            {getInitials(user.full_name)}
          </AvatarFallback>
        </Avatar>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate">{user.full_name}</p>
            <p className="text-[10px] text-sidebar-muted truncate">{user.email}</p>
          </div>
        )}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onLogout}
                className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-muted hover:text-destructive transition-colors"
                aria-label="Sair da conta"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sair</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </UiSidebarFooter>
  );
}