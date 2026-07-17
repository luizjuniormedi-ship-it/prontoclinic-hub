const password = process.env.E2E_PASSWORD;

if (!password) {
  throw new Error('E2E_PASSWORD é obrigatória para executar os testes E2E');
}

export const E2E_PASSWORD = password;
