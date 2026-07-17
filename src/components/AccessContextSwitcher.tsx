import { useEffect, useState } from "react";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { accessContextService, type AccessContextOption } from "@/services/accessContextService";
import { useToast } from "@/hooks/use-toast";
import { readStoredAccessContext } from "@/services/applicationSessionStorage";
import { activateAccessContext, sameContext } from "@/services/accessContextBootstrap";

export function AccessContextSwitcher() {
  const [options, setOptions] = useState<AccessContextOption[]>([]);
  const [current, setCurrent] = useState<AccessContextOption | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    let active = true;
    void accessContextService.listAuthorized()
      .then(async (available) => {
        if (!active) return;
        setOptions(available);
        const stored = readStoredAccessContext<AccessContextOption>();
        const selected = stored ? available.find((option) => sameContext(option, stored!)) ?? null : null;
        if (selected) setCurrent(selected);
      })
      .catch((error) => {
        if (active) toast({ title: "Contexto de acesso indisponível", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [toast]);

  const select = async (option: AccessContextOption) => {
    setLoading(true);
    try {
      await activateAccessContext(option);
      setCurrent(option);
    } catch (error) {
      toast({ title: "Não foi possível trocar o contexto", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
      setLoading(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={loading} aria-label="Selecionar empresa, unidade e perfil">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}
          <span className="hidden max-w-52 truncate md:inline">
            {current ? `${current.companyName} · ${current.unitName} · ${current.roleName}` : "Selecionar contexto"}
          </span>
          <ChevronsUpDown className="ml-2 h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Empresa, unidade e perfil</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.length === 0 ? (
          <DropdownMenuItem disabled>Nenhum vínculo autorizado</DropdownMenuItem>
        ) : options.map((option) => (
          <DropdownMenuItem
            key={`${option.membershipId}:${option.roleId}:${option.unitId}`}
            onSelect={() => void select(option)}
          >
            <Check className={`mr-2 h-4 w-4 ${current && sameContext(option, current) ? "opacity-100" : "opacity-0"}`} />
            <div>
              <div className="font-medium">{option.companyName} · {option.unitName}</div>
              <div className="text-xs text-muted-foreground">{option.roleName}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
