import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Initialize axe-core in dev only — surfaces WCAG violations in DevTools console.
if (import.meta.env.DEV) {
  void Promise.all([
    import("@axe-core/react"),
    import("react-dom"),
    import("react"),
  ]).then(([axe, ReactDOM, React]) => {
    axe.default((React as any).default ?? (React as any), ReactDOM as any, 1000);
  });
}

// Service Worker registration é feita via PWAUpdatePrompt (useRegisterSW do vite-plugin-pwa).
// Manter UMA fonte de verdade para evitar double registration.

createRoot(document.getElementById("root")!).render(<App />);
