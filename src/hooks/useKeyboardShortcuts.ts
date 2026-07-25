import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Global keyboard shortcuts:
 *   - Ctrl/Cmd+K    → open navigation search
 *   - Ctrl/Cmd+N    → new appointment
 *   - Esc           → close the first registered modal action
 *   - ?             → show shortcut help
 *   - g + d         → Dashboard
 *   - g + a         → Agenda
 *   - g + p         → Pacientes
 *   - g + m         → Cadastros mestres
 *   - g + s         → Configurações
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    let gPrefix = false;
    let gTimeout: ReturnType<typeof setTimeout>;

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      if (
        target &&
        (target.matches('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)
      ) {
        if (event.key === "Escape") target.blur();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        document.dispatchEvent(new CustomEvent("open-navigation-command"));
        return;
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === "n" || event.key === "N")) {
        event.preventDefault();
        navigate("/schedule?action=new");
        return;
      }

      if (event.key === "Escape") {
        document.querySelector<HTMLElement>("[data-close-modal]")?.click();
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        document.dispatchEvent(new CustomEvent("show-shortcuts"));
        document.dispatchEvent(new CustomEvent("toggle-shortcuts-help"));
        return;
      }

      if (gPrefix) {
        const routes: Record<string, string> = {
          d: "/",
          a: "/schedule",
          p: "/patients",
          m: "/master-data",
          s: "/settings",
        };
        const route = routes[event.key.toLowerCase()];
        if (route) {
          event.preventDefault();
          navigate(route);
          gPrefix = false;
          clearTimeout(gTimeout);
          return;
        }
      }

      if (event.key === "g" || event.key === "G") {
        gPrefix = true;
        clearTimeout(gTimeout);
        gTimeout = setTimeout(() => { gPrefix = false; }, 1500);
      }
    };

    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      clearTimeout(gTimeout);
    };
  }, [navigate]);
}
