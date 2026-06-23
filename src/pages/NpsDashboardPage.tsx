import { PageHeader } from "@/components/PageHeader";
import { NpsDashboard } from "@/components/nps/NpsDashboard";

export default function NpsDashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="NPS — Satisfação do Paciente"
        description="Análise de Net Promoter Score das pesquisas de satisfação."
      />
      <NpsDashboard />
    </div>
  );
}