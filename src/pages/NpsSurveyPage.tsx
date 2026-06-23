/**
 * NpsSurveyPage — Página pública para resposta de pesquisa NPS.
 *
 * Não requer autenticação. Acessada via link /nps/:token enviado ao paciente.
 */

import { NpsSurveyPublic } from "@/components/nps/NpsSurveyPublic";

export default function NpsSurveyPage() {
  return <NpsSurveyPublic />;
}