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
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  getAccessibleNavigation,
  getNavigationSearchValue,
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
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      commandLabel="Buscar telas e funções"
    >
      <DialogTitle className="sr-only">Todos os módulos</DialogTitle>
      <DialogDescription className="sr-only">
        Pesquise telas e funções autorizadas para o perfil ativo.
      </DialogDescription>
      <CommandInput
        aria-label="Buscar telas e funções"
        placeholder="Buscar telas e funções..."
      />
      <CommandList className="max-h-[70vh]" aria-label="Módulos disponíveis">
        <CommandEmpty>Nenhuma tela disponível para esta busca.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.id} heading={group.label}>
            {group.items.map((entry) => (
              <CommandItem
                key={entry.id}
                value={getNavigationSearchValue(entry)}
                onSelect={() => openItem(entry)}
                className="items-start gap-3 py-3"
                aria-label={`${entry.title}. ${entry.description}`}
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
