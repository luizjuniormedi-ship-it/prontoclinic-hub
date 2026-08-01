import { useEffect, useMemo, useState } from "react";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getAuthorizedJourneys,
  getAuthorizedNavigation,
  navigationAreaOrder,
  type NavigationArea,
  type NavigationItem,
  type NavigationJourney,
} from "@/config/navigation";

const RECENT_MODULES_KEY = "prontomedic-recent-modules";
const MAX_RECENT_MODULES = 5;
type LauncherView = "journeys" | NavigationArea;

interface ModuleLauncherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleName: string | null | undefined;
  storageScope: string;
  onNavigate: (url: string) => void;
}

function readRecentUrls(storageKey: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function ModuleLauncher({
  open,
  onOpenChange,
  roleName,
  storageScope,
  onNavigate,
}: ModuleLauncherProps) {
  const storageKey = `${RECENT_MODULES_KEY}:${storageScope}`;
  const [recentUrls, setRecentUrls] = useState<string[]>(() => readRecentUrls(storageKey));
  const [activeView, setActiveView] = useState<LauncherView>("journeys");
  const [query, setQuery] = useState("");
  const authorized = useMemo(
    () => getAuthorizedNavigation(roleName),
    [roleName],
  );
  const authorizedJourneys = useMemo(
    () => getAuthorizedJourneys(roleName),
    [roleName],
  );
  const availableAreas = useMemo(
    () => navigationAreaOrder.filter((area) =>
      authorized.some((item) => item.area === area)),
    [authorized],
  );
  const itemByUrl = useMemo(
    () => new Map(authorized.map((item) => [item.url, item])),
    [authorized],
  );
  const recentItems = recentUrls
    .map((url) => itemByUrl.get(url))
    .filter((item): item is NavigationItem => Boolean(item));

  useEffect(() => {
    const openSearch = () => onOpenChange(true);
    document.addEventListener("open-global-search", openSearch);
    return () => document.removeEventListener("open-global-search", openSearch);
  }, [onOpenChange]);

  useEffect(() => {
    setRecentUrls(readRecentUrls(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (!open) {
      setActiveView("journeys");
      setQuery("");
    }
  }, [open]);

  useEffect(() => {
    if (activeView === "journeys" && authorizedJourneys.length === 0) {
      setActiveView(
        availableAreas.find((area) => area !== "Meu trabalho")
          ?? availableAreas[0]
          ?? "journeys",
      );
    }
  }, [activeView, authorizedJourneys.length, availableAreas]);

  const navigateTo = (url: string, recentUrl = url) => {
    const nextRecent = [
      recentUrl,
      ...recentUrls.filter((itemUrl) => itemUrl !== recentUrl),
    ].slice(0, MAX_RECENT_MODULES);
    setRecentUrls(nextRecent);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextRecent));
    } catch {
      // Navegação continua funcional quando o armazenamento local está indisponível.
    }
    onOpenChange(false);
    onNavigate(url);
  };

  const renderItem = (item: NavigationItem) => (
    <CommandItem
      key={item.url}
      value={[
        item.title,
        item.description,
        ...(item.keywords ?? []),
      ].join(" ")}
      onSelect={() => navigateTo(item.url)}
      className="gap-3"
    >
      <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-medium">{item.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {item.description}
        </span>
      </span>
    </CommandItem>
  );

  const renderJourney = (journey: NavigationJourney) => (
    <CommandItem
      key={journey.title}
      value={[
        journey.title,
        journey.description,
        ...journey.keywords,
      ].join(" ")}
      onSelect={() => navigateTo(journey.url, journey.accessRoute)}
      className="gap-3 py-3"
    >
      <journey.icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-medium">{journey.title}</span>
        <span className="block text-xs text-muted-foreground">
          {journey.description}
        </span>
      </span>
    </CommandItem>
  );

  const searching = query.trim().length > 0;
  const showJourneys = !searching && activeView === "journeys";

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle className="sr-only">Buscar módulos e funções</DialogTitle>
      <DialogDescription className="sr-only">
        Pesquise e abra somente as áreas autorizadas para seu perfil.
      </DialogDescription>
      <CommandInput
        placeholder="Buscar tarefa, módulo ou função..."
        value={query}
        onValueChange={setQuery}
        autoFocus
      />
      <div className="min-h-12 overflow-x-auto border-b px-3 py-2">
        <Tabs
          value={activeView}
          onValueChange={(value) => setActiveView(value as LauncherView)}
        >
          <TabsList
            className="h-8 w-max min-w-full justify-start gap-1 bg-transparent p-0"
            aria-label="Filtrar módulos por área"
          >
            <TabsTrigger value="journeys" className="h-8 shrink-0 px-3 text-xs">
              Jornadas
            </TabsTrigger>
            {availableAreas.map((area) => (
              <TabsTrigger
                key={area}
                value={area}
                className="h-8 shrink-0 px-3 text-xs"
              >
                {area}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <CommandList className="max-h-[min(70vh,34rem)]">
        <CommandEmpty>Nenhum módulo ou função encontrado.</CommandEmpty>
        {!searching && activeView === "journeys" && recentItems.length > 0 && (
          <CommandGroup heading="Recentes">
            {recentItems.map(renderItem)}
          </CommandGroup>
        )}
        {showJourneys && authorizedJourneys.length > 0 && (
          <CommandGroup heading="Jornadas principais">
            {authorizedJourneys.map(renderJourney)}
          </CommandGroup>
        )}
        {navigationAreaOrder.map((area) => {
          if (!searching && activeView !== area) return null;
          const items = authorized.filter(
            (item) => item.area === area,
          );
          if (items.length === 0) return null;
          return (
            <CommandGroup key={area} heading={area}>
              {items.map(renderItem)}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
