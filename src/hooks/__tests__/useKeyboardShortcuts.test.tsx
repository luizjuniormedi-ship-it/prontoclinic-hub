import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

function ShortcutProbe({ roleName }: { roleName: string }) {
  useKeyboardShortcuts(roleName);
  return <output aria-label="Rota atual">{useLocation().pathname}</output>;
}

describe("useKeyboardShortcuts", () => {
  it("opens the module launcher with Ctrl+K", () => {
    const listener = vi.fn();
    document.addEventListener("open-navigation-command", listener);
    render(
      <MemoryRouter>
        <ShortcutProbe roleName="recepcao" />
      </MemoryRouter>,
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener("open-navigation-command", listener);
  });

  it("navigates only when the active role can use the shortcut", () => {
    const listener = vi.fn();
    document.addEventListener("open-navigation-command", listener);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ShortcutProbe roleName="dpo" />
      </MemoryRouter>,
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true }));
    expect(screen.getByRole("status", { name: "Rota atual" })).toHaveTextContent("/");
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener("open-navigation-command", listener);
  });
});
