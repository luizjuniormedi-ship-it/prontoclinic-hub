
## Plano: Tabela de Preços e Billing Automático

### 1. Migration — Criar tabela `price_table`

```sql
CREATE TABLE public.price_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_type_id UUID REFERENCES public.appointment_types(id),
  service_id UUID REFERENCES public.services_catalog(id),
  insurance_plan_id UUID,  -- NULL = preço particular
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  description TEXT,
  active BOOLEAN DEFAULT true,
  company_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Um preço por combinação tipo+convênio (ou tipo+particular)
  UNIQUE(appointment_type_id, insurance_plan_id)
);

ALTER TABLE public.price_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read prices"
  ON public.price_table FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage prices"
  ON public.price_table FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

### 2. Service — `src/services/priceTableService.ts`

- `getAll()` — lista todos os preços
- `create(input)` — cadastrar preço
- `update(id, input)` — alterar preço
- `delete(id)` — remover
- `findPrice(appointmentTypeId, insurancePlanId?)` — busca com prioridade:
  1. Preço específico do convênio
  2. Preço particular (insurance_plan_id = NULL)
  3. Preço do `services_catalog.price` como fallback
  4. Retorna 0 se nada encontrado

### 3. UI — Seção "Tabela de Preços" na MasterDataPage

- Tabela com colunas: Tipo Atendimento, Convênio, Preço, Status
- Dialog para criar/editar preço
- Select de appointment_type e insurance_plan
- Campo de valor monetário

### 4. Integração — AttendancePage

Na `handleSave`, antes de criar o billing:
```
const price = await priceTableService.findPrice(
  appointment.appointment_type_id,
  patient.insurance_plan_id
);
```
Preencher `gross_amount` e `net_amount` com o valor encontrado.

### 5. Validação — financialService

Adicionar warning (não bloqueio) quando `amount === 0`.

### Arquivos criados/alterados

| Arquivo | Ação |
|---------|------|
| Migration SQL | Criar tabela `price_table` |
| `src/services/priceTableService.ts` | Novo — CRUD + busca de preço |
| `src/pages/MasterDataPage.tsx` | Adicionar aba "Tabela de Preços" |
| `src/pages/AttendancePage.tsx` | Buscar preço ao finalizar |
| `src/services/financialService.ts` | Validação de valor |
