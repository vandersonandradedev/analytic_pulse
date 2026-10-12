import dotenv from 'dotenv';
import path from 'path';

// Carrega .env uma única vez (apps/api/.env)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export type AppEnv = 'development' | 'production' | 'test';

function read(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
}

function requireInProduction(name: string, value: string | undefined): string {
  if (value) return value;
  if (env.nodeEnv === 'production') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return '';
}

const nodeEnv = (read('NODE_ENV', 'development') as AppEnv) || 'development';

const databaseUrl = read('POSTGRES_URL') || read('DATABASE_URL');

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isDevelopment: nodeEnv === 'development',
  port: Number(read('PORT', '3001')),
  databaseUrl,
  redisUrl: read('REDIS_URL'),
  redisUrl2: read('REDIS_URL_2'),
  redisUrl3: read('REDIS_URL_3') || read('REDIS_MESAGO_URL'),
  redisUrl4: read('REDIS_URL_4') || read('REDIS_MESAGO_URL_2'),
  jwtSecret:
    read('JWT_SECRET') ||
    (nodeEnv === 'production' ? '' : 'fallback-super-secret-key-change-me'),
  cronSecret: read('CRON_SECRET'),
  corsOrigins: read('CORS_ORIGINS') || read('FRONTEND_URL') || '',
  telegramBotToken: read('TELEGRAM_BOT_TOKEN'),
  apiPublicUrl: read('API_PUBLIC_URL'),
  resendApiKey: read('RESEND_API_KEY'),
  emailFrom: read('EMAIL_FROM'),
  googleClientId: read('GOOGLE_CLIENT_ID'),
  groqApiKey: read('GROQ_API_KEY'),
  /** Flagship em produção no Groq — https://console.groq.com/docs/models */
  groqModel: read('GROQ_MODEL', 'openai/gpt-oss-120b') || 'openai/gpt-oss-120b',
  /** Synthetic browser checks (Playwright). Desligue com PLAYWRIGHT_ENABLED=false */
  playwrightEnabled: (read('PLAYWRIGHT_ENABLED', 'true') || 'true').toLowerCase() !== 'false',
  playwrightTimeoutMs: Number(read('PLAYWRIGHT_TIMEOUT_MS', '30000') || '30000'),
  /** Região atribuída aos checks executados pela API (quando não há probe remoto) */
  defaultProbeRegion: read('DEFAULT_PROBE_REGION', 'gru') || 'gru',
  /** OpenTelemetry OTLP (opcional). Sem endpoint o SDK fica desligado. */
  otelExporterOtlpEndpoint: read('OTEL_EXPORTER_OTLP_ENDPOINT'),
  otelServiceName: read('OTEL_SERVICE_NAME', 'analytic-pulse-api') || 'analytic-pulse-api',
  /** RCA automática ao abrir incidente (requer GROQ_API_KEY). Desligue com AI_RCA_AUTO=false */
  aiRcaAutoEnabled: (read('AI_RCA_AUTO', 'true') || 'true').toLowerCase() !== 'false',
  /** Vigia — agente watchman 24/7 */
  vigiaEnabled: (read('VIGIA_ENABLED', 'true') || 'true').toLowerCase() !== 'false',
  vigiaTz: read('VIGIA_TZ', 'America/Sao_Paulo') || 'America/Sao_Paulo',
  vigiaTelegramChatId: read('VIGIA_TELEGRAM_CHAT_ID'),
  vigiaAutoRemediate:
    (read('VIGIA_AUTO_REMEDIATE', 'true') || 'true').toLowerCase() !== 'false',
  /** Hora local (0–23) para digest diário; default 8h */
  vigiaDigestHour: Number(read('VIGIA_DIGEST_HOUR', '8') || '8'),
  vigiaMaxActionsPerHour: Number(read('VIGIA_MAX_ACTIONS_PER_HOUR', '10') || '10'),
  /** Auto ping / scheduler interno para checagens periódicas e auto-keepalive */
  autoPingEnabled: (read('AUTO_PING_ENABLED', 'true') || 'true').toLowerCase() !== 'false',
  autoPingIntervalMs: Number(
    read('AUTO_PING_INTERVAL_MS') ||
      (Number(read('AUTO_PING_MINUTES', '5')) * 60 * 1000) ||
      300000
  ),
  selfPingEnabled: (read('SELF_PING_ENABLED', 'true') || 'true').toLowerCase() !== 'false',
} as const;

export function assertCriticalEnv(): void {
  if (!env.databaseUrl) {
    console.error('❌ POSTGRES_URL ou DATABASE_URL não configurado — cadastro/login vão falhar.');
  }
  requireInProduction('JWT_SECRET', env.jwtSecret || undefined);
  if (env.isProduction && !env.cronSecret) {
    throw new Error('CRON_SECRET is required in production');
  }
}

export function getAllowedOrigins(): string[] {
  const defaults = [
    'https://analytic-pulse.vercel.app',
    'https://analytic-pulse-web.onrender.com',
  ];
  const fromEnv = env.corsOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...fromEnv, ...defaults])];
}
