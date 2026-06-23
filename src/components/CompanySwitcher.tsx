import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Theme = "light" | "dark";

interface CompanySwitcherProps {
  /** Current theme; controls icon and aria labels. */
  theme: Theme;
  onToggleTheme: () => void;
}

export function CompanySwitcher({ theme, onToggleTheme }: CompanySwitcherProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          onClick={onToggleTheme}
          aria-label={`Alternar para tema ${theme === "light" ? "escuro" : "claro"}`}
          aria-pressed={theme === "dark"}
        >
          {theme === "light" ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{theme === "light" ? "Tema escuro" : "Tema claro"}</TooltipContent>
    </Tooltip>
  );
}
