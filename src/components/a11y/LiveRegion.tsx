import { useState } from 'react';

interface LiveRegionProps {
  message: string;
  politeness?: 'polite' | 'assertive';
  atomic?: boolean;
}

/**
 * LiveRegion — announces dynamic changes to screen readers.
 *
 * Use polite for non-urgent updates (e.g. "Agendamento salvo com sucesso").
 * Use assertive for urgent updates (e.g. "Erro ao salvar agendamento").
 *
 * Renders visually hidden via the .sr-only utility from index.css.
 */
export function LiveRegion({ message, politeness = 'polite', atomic = true }: LiveRegionProps) {
  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic={atomic}
      className="sr-only"
    >
      {message}
    </div>
  );
}

/**
 * useLiveAnnounce — small hook to wire toast messages to a live region.
 *
 * Usage:
 *   const { message, announce } = useLiveAnnounce();
 *   announce('Paciente salvo com sucesso');
 *   return <LiveRegion message={message} />;
 *
 * The double-setState (clear then re-set) ensures SR re-announces the same
 * message if fired consecutively.
 */
export function useLiveAnnounce() {
  const [message, setMessage] = useState('');

  const announce = (msg: string) => {
    setMessage('');
    // small delay forces a real DOM mutation so SR picks it up
    setTimeout(() => setMessage(msg), 100);
  };

  return { message, announce };
}
