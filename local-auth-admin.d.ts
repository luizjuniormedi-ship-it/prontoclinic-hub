export interface ChallengeResult { status: number; body?: unknown; location?: string }
export interface MailProvider { send(message: Record<string, string>): Promise<void> }
export function createWebhookMailProvider(options: Record<string, unknown>): MailProvider;
export function createSmtpMailProvider(options: Record<string, unknown>): MailProvider;
export function mailProviderFromEnv(env?: Record<string, string | undefined>, fetchImpl?: typeof fetch): MailProvider;
export function ensureLocalAuthAdminSchema(pool: { query(sql: string): Promise<unknown> }): Promise<void>;
export function createLocalAuthAdmin(options: Record<string, unknown>): {
  invite(input: Record<string, unknown>): Promise<ChallengeResult>;
  recover(input: Record<string, unknown>): Promise<ChallengeResult>;
  consume(input: Record<string, unknown>): Promise<ChallengeResult>;
};
