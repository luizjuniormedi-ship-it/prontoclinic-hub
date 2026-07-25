import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  getAccessibleNavigation,
  navigationWorkspaces,
  type NavigationItem,
} from "@/config/navigation";

type NavigationCommandProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleName: string | null | undefined;
};

export function NavigationCommand({ open, onOpenChange, roleName }: NavigationCommandProps) {
  const navigate = useNavigate();
  const accessibleItems = useMemo(() => getAccessibleNavigation(roleName), [roleName]);
  const groups = useMemo(
    () => navigationWorkspaces
      .map((workspace) => ({
        ...workspace,
        items: accessibleItems.filter((entry) => entry.workspace === workspace.id),
      }))
      .filter((workspace) => workspace.items.length > 0),
    [accessibleItems],
  );

  const openItem = (entry: NavigationItem) => {
    navigate(entry.url);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar telas e funções..." />
      <CommandList className="max-h-[70vh]">
        <CommandEmpty>Nenhuma tela disponível para esta busca.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.id} heading={group.label}>
            {group.items.map((entry) => (
              <CommandItem
                key={entry.id}
                value={[entry.title, entry.description, ...entry.keywords].join(" ")}
                onSelect={() => openItem(entry)}
                className="items-start gap-3 py-3"
              >
                <entry.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{entry.title}</p>
                  <p className="text-xs text-muted-foreground">{entry.description}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
