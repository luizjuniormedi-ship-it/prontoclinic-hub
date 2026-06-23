/**
 * PharmacyPage — Página wrapper do módulo Farmácia/Materiais
 *
 * Renderiza <PharmacyManager /> dentro do AppLayout.
 * - Lazy-loaded via React.lazy (App.tsx)
 * - Suspense fallback com loading spinner
 * - PageHeader com título e descrição
 */

import { lazy, Suspense } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Pill } from "lucide-react";

const PharmacyManager = lazy(() =>
  import("@/components/pharmacy/PharmacyManager").then((m) => ({
    default: m.PharmacyManager,
  })),
);

function ManagerFallback() {
  return (
    <Card>
      <CardContent className="flex h-64 items-center justify-center text-muted-foreground">
        <Pill className="mr-2 h-5 w-5 animate-pulse" />
        Carregando módulo de farmácia...
      </CardContent>
    </Card>
  );
}

export default function PharmacyPage() {
  return (
    <AppLayout>
      <PageHeader
        title="Farmácia e Materiais"
        description="Catálogo, estoque, lotes, dispensação e alertas (Portaria 344/98)"
      />
      <Suspense fallback={<ManagerFallback />}>
        <PharmacyManager />
      </Suspense>
    </AppLayout>
  );
}
