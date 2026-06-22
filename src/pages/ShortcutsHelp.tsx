import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Keyboard, Search, Plus, X, HelpCircle } from "lucide-react";

interface Shortcut {
  keys: string[];
  description: string;
  icon?: React.ReactNode;
}

const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: "Ações globais",
    items: [
      { keys: ["Ctrl", "K"], description: "Focar o campo de busca global", icon: <Search className="h-3.5 w-3.5" /> },
      { keys: ["Ctrl", "N"], description: "Criar novo agendamento", icon: <Plus className="h-3.5 w-3.5" /> },
      { keys: ["Esc"], description: "Fechar modal ou caixa de diálogo aberta", icon: <X className="h-3.5 w-3.5" /> },
      { keys: ["?"], description: "Abrir esta ajuda de atalhos", icon: <HelpCircle className="h-3.5 w-3.5" /> },
    ],
  },
  {
    title: "Navegação (pressione ‘g’ e depois a letra)",
    items: [
      { keys: ["g", "d"], description: "Ir para o Dashboard" },
      { keys: ["g", "a"], description: "Ir para a Agenda" },
      { keys: ["g", "p"], description: "Ir para Pacientes" },
      { keys: ["g", "m"], description: "Ir para Master Data (Cadastros)" },
      { keys: ["g", "s"], description: "Ir para Configurações" },
    ],
  },
];

/**
 * ShortcutsHelp — modal that lists all global keyboard shortcuts.
 *
 * Mounted once near the root. It listens for the `show-shortcuts` custom event
 * dispatched by useKeyboardShortcuts when the user presses `?`.
 */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onShow = () => setOpen(true);
    document.addEventListener("show-shortcuts", onShow as EventListener);
    // Alias para integrações que escutam o nome "toggle-shortcuts-help"
    document.addEventListener("toggle-shortcuts-help", onShow as EventListener);
    return () => {
      document.removeEventListener("show-shortcuts", onShow as EventListener);
      document.removeEventListener("toggle-shortcuts-help", onShow as EventListener);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-close-modal
        aria-describedby="shortcuts-help-desc"
        className="max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" aria-hidden="true" />
            Atalhos de Teclado
          </DialogTitle>
          <DialogDescription id="shortcuts-help-desc">
            Use estas combinações para navegar mais rápido pelo sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} aria-labelledby={`group-${group.title}`}>
              <h3
                id={`group-${group.title}`}
                className="text-sm font-semibold mb-2 text-foreground"
              >
                {group.title}
              </h3>
              <ul className="space-y-1.5" role="list">
                {group.items.map((s) => (
                  <li
                    key={s.keys.join("+") + s.description}
                    className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      {s.icon && (
                        <span className="text-muted-foreground" aria-hidden="true">
                          {s.icon}
                        </span>
                      )}
                      <span>{s.description}</span>
                    </div>
                    <kbd className="flex items-center gap-1 text-xs" aria-label={s.keys.join(" mais ")}>
                      {s.keys.map((k, i) => (
                        <span key={k + i} className="flex items-center gap-1">
                          <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground shadow-sm">
                            {k}
                          </kbd>
                          {i < s.keys.length - 1 && (
                            <span className="text-muted-foreground" aria-hidden="true">+</span>
                          )}
                        </span>
                      ))}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Pressione <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">?</kbd> a qualquer momento para reabrir esta ajuda.
        </p>
      </DialogContent>
    </Dialog>
  );
}
