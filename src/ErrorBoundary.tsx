import { Component, ReactNode } from "react";

interface State { err: Error | null; info: string | null; }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null, info: null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error, info: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] CAUGHT:", err?.stack || err);
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] COMPONENT STACK:", info?.componentStack);
    this.setState({ info: info?.componentStack || null });
  }

  render() {
    if (this.state.err) {
      return (
        <div style={{
          fontFamily: "system-ui, sans-serif",
          padding: 24,
          background: "#1a1a1a",
          color: "#fff",
          minHeight: "100vh",
        }}>
          <h1 style={{ color: "#ff6b6b" }}>❌ ERRO DE RENDER</h1>
          <pre style={{ background: "#000", padding: 12, borderRadius: 6, overflow: "auto" }}>
            {String(this.state.err?.stack || this.state.err?.message || this.state.err)}
          </pre>
          {this.state.info && (
            <>
              <h2 style={{ color: "#ffd93d" }}>Component stack:</h2>
              <pre style={{ background: "#000", padding: 12, borderRadius: 6, overflow: "auto", fontSize: 11 }}>
                {this.state.info}
              </pre>
            </>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}