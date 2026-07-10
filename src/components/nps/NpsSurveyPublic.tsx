/**
 * NpsSurveyPublic — Formulário público de resposta NPS.
 *
 * Componente público (rota /nps/:token sem auth) para que o paciente
 * responda a pesquisa via link enviado por e-mail/WhatsApp/SMS.
 *
 * Decisões:
 *   - Acesso público — não exige login. RLS permite INSERT em nps_respostas
 *     tanto para anon quanto para authenticated.
 *   - UI simples e acessível (HTML semântico, foco visível, contraste AA).
 *   - Perguntas dinâmicas (lê de cd_template_perguntas JSONB).
 *   - Estado de sucesso ao final, sem expor dados sensíveis.
 */

import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Heart, Star, CheckCircle2, Loader2 } from "lucide-react";
import { pesquisasService, respostasService, type Pesquisa, type Pergunta } from "@/services/npsService";
import { toast } from "@/hooks/use-toast";

export function NpsSurveyPublic() {
  const { token } = useParams<{ token: string }>();
  const pesquisaId = Number(token);
  const [notaNps, setNotaNps] = useState<number | null>(null);
  const [comentario, setComentario] = useState<string>("");
  const [pacienteId, setPacienteId] = useState<string>("");
  const [enviado, setEnviado] = useState(false);

  const { data: pesquisa, isLoading } = useQuery({
    queryKey: ["nps-pesquisa-publica", pesquisaId],
    queryFn: () => pesquisasService.getById(pesquisaId),
    enabled: !!pesquisaId && !Number.isNaN(pesquisaId),
  });

  useEffect(() => {
    // Para UX: foco no heading principal
    const h1 = document.getElementById("nps-survey-title");
    h1?.focus();
  }, [pesquisa]);

  const enviarMut = useMutation({
    mutationFn: respostasService.create,
    onSuccess: () => setEnviado(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (notaNps === null) return;
    const id = Number(pacienteId);
    if (!id || id <= 0) {
      toast({ title: "Informe o ID do paciente", description: "Fornecido no e-mail/SMS.", variant: "destructive" });
      return;
    }
    enviarMut.mutate({
      cd_pesquisa: pesquisaId,
      cd_paciente: id,
      nr_nota_nps: notaNps,
      ds_comentario: comentario || null,
      ds_origem: "EMAIL",
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-white">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!pesquisa) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-blue-50 to-white">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Pesquisa não encontrada</CardTitle>
            <CardDescription>Verifique o link enviado.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (enviado) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-green-50 to-white">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="mx-auto mb-2 h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            </div>
            <CardTitle>Obrigado pelo seu feedback!</CardTitle>
            <CardDescription>Sua resposta foi registrada com sucesso.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const perguntas: Pergunta[] = (pesquisa.cd_template_perguntas ?? []) as Pergunta[];

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-blue-50 to-white">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-red-500" />
            <CardTitle>{pesquisa.ds_titulo}</CardTitle>
          </div>
          {pesquisa.ds_descricao && <CardDescription>{pesquisa.ds_descricao}</CardDescription>}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* ID do paciente — fornecido no link/email */}
            <div>
              <Label htmlFor="paciente-id">ID do Paciente *</Label>
              <Input
                id="paciente-id"
                type="number"
                min={1}
                required
                value={pacienteId}
                onChange={(e) => setPacienteId(e.target.value)}
                placeholder="Informe o número do seu prontuário"
                aria-describedby="paciente-help"
              />
              <p id="paciente-help" className="text-xs text-muted-foreground mt-1">
                Enviado no link/e-mail. Em caso de dúvida, entre em contato com a clínica.
              </p>
            </div>

            {/* Pergunta NPS principal */}
            {perguntas.filter((p) => p.tipo === "NPS").map((p) => (
              <div key={p.id}>
                <Label className="text-base">{p.texto}</Label>
                <div className="flex flex-wrap gap-1 mt-3" role="radiogroup" aria-labelledby={`lbl-${p.id}`}>
                  {Array.from({ length: 11 }, (_, i) => i).map((nota) => {
                    const color =
                      nota <= 6 ? "bg-red-100 hover:bg-red-200 text-red-900" :
                      nota <= 8 ? "bg-yellow-100 hover:bg-yellow-200 text-yellow-900" :
                      "bg-green-100 hover:bg-green-200 text-green-900";
                    const selected = notaNps === nota ? "ring-2 ring-primary " : "";
                    return (
                      <button
                        key={nota}
                        type="button"
                        role="radio"
                        aria-checked={notaNps === nota}
                        onClick={() => setNotaNps(nota)}
                        className={`${color} ${selected} w-10 h-10 rounded font-semibold transition-all`}
                        aria-label={`Nota ${nota}`}
                      >
                        {nota}
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>0 = Muito insatisfeito</span>
                  <span>10 = Muito satisfeito</span>
                </div>
              </div>
            ))}

            {/* Perguntas ESCALA_5 */}
            {perguntas.filter((p) => p.tipo === "ESCALA_5").map((p) => (
              <div key={p.id}>
                <Label>{p.texto}</Label>
                <div className="flex gap-1 mt-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="w-10 h-10 rounded border hover:bg-blue-50"
                      aria-label={`${n} estrelas`}
                    >
                      <Star className="h-4 w-4 mx-auto" />
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Comentário livre */}
            <div>
              <Label htmlFor="comentario">Comentário (opcional)</Label>
              <Textarea
                id="comentario"
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                rows={4}
                placeholder="Compartilhe sua experiência..."
                maxLength={2000}
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={notaNps === null || enviarMut.isPending}
            >
              {enviarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enviar Resposta
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              Sua resposta é confidencial e utilizada apenas para melhoria contínua.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}