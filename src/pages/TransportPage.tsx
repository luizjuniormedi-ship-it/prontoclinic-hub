import { PageHeader } from "@/components/PageHeader";
import { TransportManager } from "@/components/transport/TransportManager";

export default function TransportPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Remoção e Transporte"
        description="Gestão de veículos, equipe e solicitações de remoção sanitária."
      />
      <TransportManager />
    </div>
  );
}