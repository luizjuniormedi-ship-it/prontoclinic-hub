import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialPage from './FinancialPage';
import { financialService, type DbFinancialTransaction } from '@/services/financialService';

vi.mock('@/services/financialService', () => ({
  financialService: {
    getAll: vi.fn(),
    recordPayment: vi.fn(),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const transaction: DbFinancialTransaction = {
  id: '10', company_id: 'company', unit_id: null, patient_id: null,
  billing_id: '10', professional_id: null, appointment_id: '30',
  amount: 150, received_amount: 0, balance_amount: 150, discount: 0,
  payment_method: null, status: 'pendente', due_date: '2026-07-20',
  payment_date: null, notes: null, created_at: '2026-07-12T00:00:00Z',
  patient_name: 'Paciente CI',
};

describe('FinancialPage', () => {
  beforeEach(() => {
    vi.mocked(financialService.getAll).mockResolvedValue([transaction]);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('31111111-1111-4111-8111-111111111111');
  });

  it('bloqueia clique duplo e preserva a chave idempotente', async () => {
    let release!: () => void;
    vi.mocked(financialService.recordPayment).mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; })
    );

    render(<FinancialPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar' }));
    fireEvent.change(screen.getByLabelText('Valor recebido *'), { target: { value: '50' } });

    const confirm = screen.getByRole('button', { name: 'Confirmar' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(financialService.recordPayment).toHaveBeenCalledTimes(1);
    expect(financialService.recordPayment).toHaveBeenCalledWith(
      '10', 50, 'pix', '31111111-1111-4111-8111-111111111111'
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvando...' })).toBeDisabled());

    release();
    await waitFor(() => expect(financialService.getAll).toHaveBeenCalledTimes(2));
  });
});
