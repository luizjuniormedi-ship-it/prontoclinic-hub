import { PageHeader } from "@/components/PageHeader";
import { PurchasesManager } from "@/components/purchases/PurchasesManager";

export default function PurchasesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Compras e Suprimentos"
        description="Gestão de fornecedores, cotações comparativas e ordens de compra."
      />
      <PurchasesManager />
    </div>
  );
}