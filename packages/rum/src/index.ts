import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from 'web-vitals';

export type RumInitOptions = {
  /** URL base da API, ex.: https://analytic-pulse-api.onrender.com */
  endpoint: string;
  /** Token do site (ap_rum_…) */
  token: string;
  /** Amostra 0–1 (default 1) */
  sampleRate?: number;
  /** Desliga captura de erros */
  captureErrors?: boolean;
  /** Desliga page views */
  capturePageViews?: boolean;
  /** Desliga Web Vitals */
  captureWebVitals?: boolean;
};

type RumEvent = {
  type: 'page_view' | 'web_vital' | 'error' | 'custom';
  name?: string;
  value?: number | null;
  url?: string;
  path?: string;
  referrer?: string;
  session_id?: string;
  meta?: Record<string, unknown>;
  ts?: string;
};

let config: RumInitOptions | null = null;
let sessionId = '';
let queue: RumEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function shouldSample(rate: number): boolean {
  return Math.random() < rate;
}

function enqueue(event: RumEvent): void {
  if (!config) return;
  queue.push({
    ...event,
    session_id: sessionId,
    url: event.url ?? (typeof location !== 'undefined' ? location.href : undefined),
    path: event.path ?? (typeof location !== 'undefined' ? location.pathname : undefined),
    referrer:
      event.referrer ??
      (typeof document !== 'undefined' ? document.referrer || undefined : undefined),
    ts: event.ts ?? new Date().toISOString(),
  });
  if (queue.length >= 10) {
    void flush();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, 2000);
  }
}

async function flush(): Promise<void> {
  if (!config || queue.length === 0) return;
  const batch = queue.splice(0, 50);
  const base = config.endpoint.replace(/\/$/, '');
  const url = `${base}/api/rum/ingest`;
  const body = JSON.stringify({ events: batch });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body,
      keepalive: true,
      mode: 'cors',
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        // Token inválido ou não autorizado: limpa a fila e evita loops
        queue = [];
        return;
      }
    }
  } catch {
    // re-enfileira no início (best effort)
    queue.unshift(...batch);
  }
}

function onVital(metric: Metric): void {
  enqueue({
    type: 'web_vital',
    name: metric.name,
    value: Math.round(metric.value * 100) / 100,
    meta: {
      id: metric.id,
      rating: metric.rating,
      navigationType: metric.navigationType,
      delta: metric.delta,
    },
  });
}

function trackPageView(): void {
  enqueue({
    type: 'page_view',
    name: typeof document !== 'undefined' ? document.title : 'page',
  });
}

function trackError(message: string, meta?: Record<string, unknown>): void {
  enqueue({
    type: 'error',
    name: message.slice(0, 200),
    meta,
  });
}

/**
 * Inicializa o RUM no browser do usuário final.
 * Seguro chamar uma vez no bootstrap do app.
 */
export function init(options: RumInitOptions): void {
  if (typeof window === 'undefined') return;
  if (started) return;

  const sampleRate = options.sampleRate ?? 1;
  if (!shouldSample(sampleRate)) {
    config = null;
    return;
  }

  config = options;
  sessionId = uuid();
  started = true;

  if (options.capturePageViews !== false) {
    trackPageView();
  }

  if (options.captureWebVitals !== false) {
    onCLS(onVital);
    onINP(onVital);
    onLCP(onVital);
    onFCP(onVital);
    onTTFB(onVital);
  }

  if (options.captureErrors !== false) {
    window.addEventListener('error', (ev) => {
      trackError(ev.message || 'error', {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      });
    });
    window.addEventListener('unhandledrejection', (ev) => {
      const reason = ev.reason;
      const msg =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'unhandledrejection';
      trackError(msg, { kind: 'unhandledrejection' });
    });
  }

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
  window.addEventListener('pagehide', () => {
    void flush();
  });
}

/** Envia evento customizado */
export function track(
  name: string,
  value?: number,
  meta?: Record<string, unknown>
): void {
  enqueue({
    type: 'custom',
    name,
    value: value ?? null,
    meta,
  });
}

export function flushNow(): Promise<void> {
  return flush();
}
