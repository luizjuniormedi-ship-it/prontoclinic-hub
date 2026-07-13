import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { tissService } from "@/services/tissService";

export interface TissGuiaFormProps {
  protocolDialogOpen: boolean;
  setProtocolDialogOpen: (open: boolean) => void;
}

export function TissGlosaList() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["tiss-glosas-read"],
    queryFn: () => tissService.listGlosas(),
  });

  if (isError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Nao foi possivel carregar as glosas TISS</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>Nenhuma acao ou transmissao foi executada.</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Tentar novamente
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Glosa</TableHead>
          <TableHead>Registro TISS</TableHead>
          <TableHead>Codigo</TableHead>
          <TableHead>Motivo</TableHead>
          <TableHead>Valor</TableHead>
          <TableHead>Data</TableHead>
          <TableHead>Status do recurso</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow>
            <TableCell colSpan={7} className="py-8 text-center">
              <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />
              Carregando...
            </TableCell>
          </TableRow>
        ) : (data || []).length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
              Nenhuma glosa encontrada.
            </TableCell>
          </TableRow>
        ) : (
          data?.map((glosa) => (
            <TableRow key={glosa.id}>
              <TableCell>#{glosa.id}</TableCell>
              <TableCell>#{glosa.tiss_xml_id}</TableCell>
              <TableCell>{glosa.denial_code || "-"}</TableCell>
              <TableCell>{glosa.denial_reason || "-"}</TableCell>
              <TableCell>
                {glosa.denial_amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </TableCell>
              <TableCell>{new Date(`${glosa.denial_date}T00:00:00`).toLocaleDateString("pt-BR")}</TableCell>
              <TableCell>{glosa.appeal_status}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export function TissGuiaForm({
  protocolDialogOpen,
  setProtocolDialogOpen,
}: TissGuiaFormProps) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["tiss-protocols-read"],
    queryFn: () => tissService.listProtocols(),
    enabled: protocolDialogOpen,
  });

  return (
    <Dialog open={protocolDialogOpen} onOpenChange={setProtocolDialogOpen}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Metadados dos protocolos TISS</DialogTitle>
          <DialogDescription>
            Consulta somente leitura. Endpoints, certificados e credenciais nao sao exibidos.
          </DialogDescription>
        </DialogHeader>

        {isError ? (
          <Alert variant="destructive" role="alert">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Nao foi possivel carregar os protocolos</AlertTitle>
            <AlertDescription>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-1 h-4 w-4" />
                Tentar novamente
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operadora</TableHead>
                <TableHead>Versao</TableHead>
                <TableHead>Ambiente</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead>Ultimo teste</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center">Carregando...</TableCell>
                </TableRow>
              ) : (data || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Nenhum protocolo encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                data?.map((protocol) => (
                  <TableRow key={protocol.id}>
                    <TableCell>{protocol.insurance_company_name}</TableCell>
                    <TableCell>{protocol.tiss_version}</TableCell>
                    <TableCell>{protocol.environment}</TableCell>
                    <TableCell>{protocol.active ? "Sim" : "Nao"}</TableCell>
                    <TableCell>
                      {protocol.last_test_at
                        ? new Date(protocol.last_test_at).toLocaleString("pt-BR")
                        : "-"}
                    </TableCell>
                    <TableCell>{protocol.last_test_status || "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setProtocolDialogOpen(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default TissGuiaForm;
