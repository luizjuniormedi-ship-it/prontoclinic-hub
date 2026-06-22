/**
 * ConsentimentosTab — LGPD art. 8 opt-in/opt-out por canal
 * Migration: 20260101000006_lgpd.sql
 * Service:   src/services/lgpdService.ts
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Shield, ShieldCheck, Search } from "lucide-react";
import { toast } from "sonner";
import {
  lgpdService,
  CANAL,
  CANAL_LABEL,
  type CanalCode,
} from "@/services/lgpdService";
import { patientsService } from "@/services/patientsService";

export function ConsentimentosTab() {
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: patients } = useQuery({
    queryKey: ["patients-search", patientSearch],
    queryFn: () => patientsService.search(patientSearch || ""),
    enabled: patientSearch.length >= 2,
  });

  const { data: consentimentos, isLoading } = useQuery({
    queryKey: ["lgpd-consentimentos", selectedPatientId],
    queryFn: () => lgpdService.getConsentimentos(selectedPatientId!),
    enabled: !!selectedPatientId,
  });

  const updateConsent = useMutation({
    mutationFn: (args: { canal: CanalCode; optin: boolean }) =>
      lgpdService.updateConsentimento(
        selectedPatientId!,
        args.canal,
        args.optin,
        null,
        navigator.userAgent,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lgpd-consentimentos", selectedPatientId] });
      toast.success("Consentimento registrado com sucesso");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canais = Object.entries(CANAL) as Array<[keyof typeof CANAL, CanalCode]>;
  const consentimentoPorCanal = (canal: CanalCode) =>
    consentimentos?.find((c) => c.cd_canal === canal && !c.dt_revocacao);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Consentimentos Granulares
        </CardTitle>
        <CardDescription>
          LGPD art. 8 — opt-in/opt-out registrado por canal com prova de versao, IP e data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar paciente por nome, CPF ou telefone..."
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {patients && patients.length > 0 && !selectedPatientId && (
          <div className="border rounded-md max-h-48 overflow-y-auto">
            {patients.slice(0, 10).map((p) => (
              <div
                key={p.id}
                className="p-2 hover:bg-accent cursor-pointer flex justify-between"
                onClick={() => {
                  setSelectedPatientId(Number(p.id));
                  setPatientSearch("");
                }}
              >
                <span>{p.name}</span>
                <span className="text-sm text-muted-foreground">{p.cpf}</span>
              </div>
            ))}
          </div>
        )}

        {selectedPatientId && (
          <>
            <div className="flex items-center justify-between bg-accent/50 p-3 rounded-md">
              <span className="font-medium">Paciente ID: {selectedPatientId}</span>
              <Button variant="ghost" size="sm" onClick={() => setSelectedPatientId(null)}>
                Trocar paciente
              </Button>
            </div>

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Carregando consentimentos...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Canal</TableHead>
                    <TableHead>Opt-in</TableHead>
                    <TableHead>Versao do Termo</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Hash</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {canais.map(([nome, codigo]) => {
                    const c = consentimentoPorCanal(codigo);
                    return (
                      <TableRow key={codigo}>
                        <TableCell className="font-medium">{CANAL_LABEL[codigo]}</TableCell>
                        <TableCell>
                          <Switch
                            checked={c?.lg_optin ?? false}
                            onCheckedChange={(v) =>
                              updateConsent.mutate({ canal: codigo, optin: v })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          {c ? (
                            <code className="text-xs">{c.versao_termo}</code>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {c ? (
                            <span className="text-xs">
                              {new Date(c.dt_optin).toLocaleString("pt-BR")}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {c ? (
                            <code className="text-xs text-muted-foreground">
                              {c.texto_termo_hash.substring(0, 12)}...
                            </code>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </>
        )}

        {!selectedPatientId && (
          <div className="text-center py-12 text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Selecione um paciente para gerenciar consentimentos</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ConsentimentosTab;
