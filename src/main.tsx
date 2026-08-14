import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary";
import "./index.css";

// Initialize axe-core in dev only — surfaces WCAG violations in DevTools console.
if (import.meta.env.DEV) {
  void Promise.all([
    import("@axe-core/react"),
    import("react-dom"),
    import("react"),
  ]).then(([axe, ReactDOM, React]) => {
    void axe.default(React, ReactDOM, 1000);
  });
}

// Remove service workers de versões anteriores. O cache offline de bundles foi
// desativado até existir uma estratégia de atualização compatível com operação clínica.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => void registration.unregister());
  });
}

function boot() {
  try {
    createRoot(document.getElementById("root")!).render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    );
  } catch (err: unknown) {
    console.error("[BOOT] Falha fatal ao iniciar React:", err);
    const root = document.getElementById("root");
    if (root) {
      const errorDetails = err instanceof Error
        ? err.stack ?? err.message
        : String(err);

      root.innerHTML = `
        <div style="font-family:system-ui,sans-serif;padding:24px;background:#1a1a1a;color:#fff;min-height:100vh">
          <h1 style="color:#ff6b6b;margin:0 0 12px">❌ Falha ao iniciar o aplicativo</h1>
          <p style="color:#aaa;margin:0 0 16px">Ocorreu um erro durante a inicialização. Detalhes abaixo:</p>
          <pre data-boot-error style="background:#000;padding:12px;border-radius:6px;overflow:auto;font-size:12px;white-space:pre-wrap"></pre>
          <hr style="border:0;border-top:1px solid #333;margin:20px 0">
          <p style="color:#aaa;font-size:13px">Verifique o console do navegador (F12) para mais detalhes.</p>
        </div>`;
      const errorOutput = root.querySelector<HTMLElement>("[data-boot-error]");
      if (errorOutput) errorOutput.textContent = errorDetails;
    }
  }
}

boot();
