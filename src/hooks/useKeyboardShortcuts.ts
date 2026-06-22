import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Global keyboard shortcuts:
 *   - Ctrl+K        → focus global search
 *   - Ctrl+N        → new appointment (schedule + action=new)
 *   - Esc           → click first [data-close-modal] element
 *   - ?             → dispatch 'show-shortcuts' custom event
 *   - g + d         → navigate to Dashboard
 *   - g + a         → navigate to Agenda
 *   - g + p         → navigate to Pacientes
 *   - g + m         → navigate to Master Data
 *   - g + s         → navigate to Settings
 *
 * Shortcuts are suppressed while typing in inputs/textareas/contenteditable
 * to avoid stealing keys during form filling.
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    let gPrefix = false;
    let gTimeout: ReturnType<typeof setTimeout>;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;

      // Suppress shortcuts while typing in form controls
      if (
        target &&
        (target.matches('input, textarea, select, [contenteditable="true"]') ||
          target.isContentEditable)
      ) {
        // Esc still works inside inputs (Radix dialogs listen to it anyway)
        if (e.key === 'Escape') {
          (target as HTMLElement).blur();
        }
        return;
      }

      // Ctrl/Cmd + K → focus search
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
        return;
      }

      // Ctrl/Cmd + N → new appointment
      if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        navigate('/schedule?action=new');
        return;
      }

      // Esc → close topmost modal
      if (e.key === 'Escape') {
        const closeBtn = document.querySelector<HTMLElement>('[data-close-modal]');
        closeBtn?.click();
        return;
      }

      // ? → show shortcuts help
      if (e.key === '?') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('show-shortcuts'));
        // Alias para integrações que escutam o nome "toggle-shortcuts-help"
        document.dispatchEvent(new CustomEvent('toggle-shortcuts-help'));
        return;
      }

      // Two-key chords: g + {d, a, p, m, s}
      if (gPrefix) {
        const map: Record<string, string> = {
          d: '/',
          a: '/schedule',
          p: '/patients',
          m: '/master-data',
          s: '/settings',
        };
        const key = e.key.toLowerCase();
        if (map[key]) {
          e.preventDefault();
          navigate(map[key]);
          gPrefix = false;
          clearTimeout(gTimeout);
          return;
        }
      }

      // First "g" → enable prefix mode for 1500ms
      if (e.key === 'g' || e.key === 'G') {
        gPrefix = true;
        clearTimeout(gTimeout);
        gTimeout = setTimeout(() => {
          gPrefix = false;
        }, 1500);
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      clearTimeout(gTimeout);
    };
  }, [navigate]);
}