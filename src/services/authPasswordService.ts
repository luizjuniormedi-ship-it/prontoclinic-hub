type AuthError = { message: string } | null;

export interface PasswordRecoveryClient {
  resetPasswordForEmail(email: string, options: { redirectTo: string }): Promise<{ error: AuthError }>;
}

export interface PasswordUpdateClient {
  updateUser(attributes: {
    password: string;
  }): Promise<{ error: AuthError }>;
  signOut(options: { scope: "global" }): Promise<{ error: AuthError }>;
}

export async function requestPasswordReset(
  client: PasswordRecoveryClient,
  email: string,
  redirectTo: string,
): Promise<{ accepted: true }> {
  try {
    await client.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
  } catch {
    // A resposta pública é deliberadamente idêntica para contas existentes ou não.
  }
  return { accepted: true };
}

export async function updatePasswordAndLogout(
  client: PasswordUpdateClient,
  password: string,
  revokeApplicationSessions?: () => Promise<void>,
): Promise<void> {
  const update = await client.updateUser({ password });
  if (update.error) throw new Error(update.error.message);

  if (revokeApplicationSessions) {
    await revokeApplicationSessions();
  } else {
    const logout = await client.signOut({ scope: "global" });
    if (logout.error) throw new Error(logout.error.message);
  }
}
