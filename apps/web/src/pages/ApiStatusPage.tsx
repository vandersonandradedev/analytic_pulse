import React, { useEffect, useState } from 'react';
import { ShieldCheck, Database, Server, RefreshCw, Cpu, HardDrive, Zap } from 'lucide-react';
import { getApiHealth } from '../services/api';

interface RedisMetricInfo {
  connected: boolean;
  error?: string;
  metrics?: {
    memory: {
      used_mb: number;
      peak_mb: number;
      max_mb: number | null;
      usage_pct: number | null;
    };
    clients: { connected: number; blocked: number };
    stats: {
      total_commands: number;
      ops_per_sec: number;
      hit_rate: number | null;
      total_keys: number;
    };
    server: {
      version: string | null;
      uptime_seconds: number;
      uptime_days: number;
    };
  } | null;
}

interface HealthData {
  status: string;
  timestamp?: string;
  latency_ms?: number;
  error?: string;
  api?: {
    uptime_seconds: number;
    memory: {
      rss_mb: number;
      heap_used_mb: number;
      heap_total_mb: number;
    };
    node_version: string;
  };
  postgres?: {
    connected: boolean;
    schema_ready: boolean;
    error?: string;
    metrics?: {
      size: { bytes: number; pretty: string };
      tables: number;
      connections: {
        active: number;
        idle: number;
        total: number;
        pool_total: number;
        pool_idle: number;
        pool_waiting: number;
      };
      top_tables: Array<{ name: string; rows: number }>;
    } | null;
  };
  redis?: RedisMetricInfo;
  redis2?: RedisMetricInfo;
  redis3?: RedisMetricInfo;
  redis4?: RedisMetricInfo;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function StatusBadge({ ok, labelOk, labelFail }: { ok: boolean; labelOk: string; labelFail: string }) {
  const cls = ok
    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
    : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
  return <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${cls}`}>{ok ? labelOk : labelFail}</span>;
}

function MetricRow({ label, value, unit }: { label: string; value: string | number | null | undefined; unit?: string }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
        {value}{unit ? ' ' + unit : ''}
      </span>
    </div>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-1.5 overflow-hidden">
      <div className={`h-2 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function RedisMetricCard({ title, data, envName }: { title: string; data?: RedisMetricInfo; envName: string }) {
  const connected = data?.connected ?? false;
  const metrics = data?.metrics;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700 text-sm">
        <Zap className="w-4 h-4 text-rose-500" /> {title}
      </h3>
      {metrics ? (
        <div>
          <div className="py-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Uso de Memória</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {metrics.memory.used_mb} MB / {metrics.memory.max_mb || 30} MB
                {metrics.memory.usage_pct !== null ? ` (${metrics.memory.usage_pct}%)` : ''}
              </span>
            </div>
            <ProgressBar
              value={metrics.memory.used_mb}
              max={metrics.memory.max_mb || 30}
              color="bg-rose-500"
            />
          </div>
          <MetricRow label="Memória de Pico (Peak)" value={metrics.memory.peak_mb} unit="MB" />
          <MetricRow label="Total de Chaves (Keys)" value={metrics.stats.total_keys} />
          <MetricRow label="Operações por Segundo" value={metrics.stats.ops_per_sec} />
          <MetricRow label="Comandos Processados" value={formatNumber(metrics.stats.total_commands)} />
          <MetricRow label="Hit Rate (Acertos)" value={metrics.stats.hit_rate !== null ? `${metrics.stats.hit_rate}%` : 'N/A'} />
          <MetricRow label="Clientes Conectados" value={metrics.clients.connected} />
          <MetricRow label="Versão do Redis" value={metrics.server.version} />
          <MetricRow label="Tempo Ativo (Uptime)" value={formatUptime(metrics.server.uptime_seconds)} />
        </div>
      ) : (
        <div className="text-xs text-gray-400 py-4 text-center">
          {connected
            ? 'Conectado ao Redis.'
            : `${title} desconectado. Adicione ${envName} para habilitar.`}
        </div>
      )}
    </div>
  );
}

export function ApiStatusPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const data = await getApiHealth();
      setHealth(data);
    } catch (err) {
      setHealth({ status: 'offline', error: String(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !health) {
    return (
      <div className="p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
        <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mb-3" />
        <p className="text-sm font-medium text-gray-500">Conectando aos serviços de infraestrutura...</p>
      </div>
    );
  }

  const isOk = health?.status === 'ok';
  const pg = health?.postgres;
  const rd1 = health?.redis;
  const rd2 = health?.redis2;
  const rd3 = health?.redis3;
  const rd4 = health?.redis4;
  const api = health?.api;

  // Decide whether to display Redis 4
  const hasRd4 = Boolean(rd4 && (rd4.connected || (rd4.error && !rd4.error.includes('not configured'))));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
            Status & Consumo da Infraestrutura
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Monitoramento em tempo real do Backend, PostgreSQL (Neon) e instâncias Redis Cloud (torqueOS, Fluorescent e Mesago)
          </p>
        </div>
        <button
          onClick={fetchHealth}
          className="p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-200"
        >
          <RefreshCw className={`w-4 h-4 text-indigo-500 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Main Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* API Server */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                <Server className="w-4 h-4 text-blue-500" /> API Server
              </h3>
              <StatusBadge ok={isOk} labelOk="Online" labelFail="Degraded" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : 'N/A'}
            </p>
            {health?.latency_ms !== undefined && (
              <p className="text-xs text-indigo-500 font-medium mt-1">
                Latência: {health.latency_ms} ms
              </p>
            )}
          </div>
          {health?.error && (
            <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 p-2 rounded mt-3">{health.error}</p>
          )}
        </div>

        {/* PostgreSQL */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                <Database className="w-4 h-4 text-purple-500" /> PostgreSQL
              </h3>
              <StatusBadge ok={pg?.connected ?? false} labelOk="Conectado" labelFail="Desconectado" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {pg?.connected && pg?.schema_ready ? 'Schema OK' : pg?.error || 'Pendente'}
            </p>
          </div>
          {pg?.error && (
            <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 p-2 rounded mt-3">{pg.error}</p>
          )}
        </div>

        {/* Redis 1 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                <ShieldCheck className="w-4 h-4 text-rose-500" /> Redis 1 (torqueOS)
              </h3>
              <StatusBadge ok={rd1?.connected ?? false} labelOk="Conectado" labelFail="Desconectado" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {rd1?.connected ? 'Cache ativo' : rd1?.error || 'Não configurado'}
            </p>
          </div>
        </div>

        {/* Redis 2 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                <ShieldCheck className="w-4 h-4 text-rose-500" /> Redis 2 (Fluorescent)
              </h3>
              <StatusBadge ok={rd2?.connected ?? false} labelOk="Conectado" labelFail="Desconectado" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {rd2?.connected ? 'Cache ativo' : rd2?.error || 'Não configurado'}
            </p>
          </div>
        </div>

        {/* Redis 3 (Mesago) */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                <ShieldCheck className="w-4 h-4 text-rose-500" /> Redis Mesago
              </h3>
              <StatusBadge ok={rd3?.connected ?? false} labelOk="Conectado" labelFail="Desconectado" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {rd3?.connected ? 'Cache ativo' : rd3?.error || 'Não configurado'}
            </p>
          </div>
        </div>

        {/* Redis 4 (Mesago 2 - optional) */}
        {hasRd4 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                  <ShieldCheck className="w-4 h-4 text-rose-500" /> Redis Mesago 2
                </h3>
                <StatusBadge ok={rd4?.connected ?? false} labelOk="Conectado" labelFail="Desconectado" />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {rd4?.connected ? 'Cache ativo' : rd4?.error || 'Não configurado'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Detailed Metrics Section */}
      <h2 className="text-lg font-bold text-gray-800 dark:text-white pt-2">Métricas de Consumo & Performance</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {/* API Metrics */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700 text-sm">
            <Cpu className="w-4 h-4 text-blue-500" /> Servidor API (Node.js)
          </h3>
          {api ? (
            <div>
              <MetricRow label="Tempo Ativo (Uptime)" value={formatUptime(api.uptime_seconds)} />
              <MetricRow label="Versão do Node.js" value={api.node_version} />
              <MetricRow label="Memória RAM do Servidor" value={api.memory.rss_mb} unit="MB" />
              <div className="py-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 dark:text-gray-400">Heap de Memória</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-200">
                    {api.memory.heap_used_mb} / {api.memory.heap_total_mb} MB
                  </span>
                </div>
                <ProgressBar value={api.memory.heap_used_mb} max={api.memory.heap_total_mb} color="bg-blue-500" />
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-400 py-4 text-center">Aguardando métricas...</div>
          )}
        </div>

        {/* PostgreSQL Metrics */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700 text-sm">
            <HardDrive className="w-4 h-4 text-purple-500" /> PostgreSQL (Neon DB)
          </h3>
          {pg?.metrics ? (
            <div>
              <MetricRow label="Tamanho do Banco" value={pg.metrics.size.pretty} />
              <MetricRow label="Total de Tabelas" value={pg.metrics.tables} />
              <MetricRow label="Conexões Ativas" value={pg.metrics.connections.active} />
              <MetricRow label="Conexões Idle" value={pg.metrics.connections.idle} />
              <MetricRow
                label="Pool de Conexões"
                value={`${pg.metrics.connections.pool_total - pg.metrics.connections.pool_idle} / ${pg.metrics.connections.pool_total}`}
              />
              {pg.metrics.top_tables.length > 0 && (
                <div className="pt-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 block mb-1">Principais Tabelas</span>
                  <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                    {pg.metrics.top_tables.slice(0, 5).map((t) => (
                      <div key={t.name} className="flex items-center justify-between text-xs py-0.5">
                        <span className="text-gray-600 dark:text-gray-300 font-mono">{t.name}</span>
                        <span className="text-gray-400">{formatNumber(t.rows)} reg</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-gray-400 py-4 text-center">
              {pg?.connected ? 'Conectado ao Neon.' : 'Desconectado.'}
            </div>
          )}
        </div>

        {/* Redis 1 */}
        <RedisMetricCard title="Redis 1 (torqueOS)" data={rd1} envName="REDIS_URL" />

        {/* Redis 2 */}
        <RedisMetricCard title="Redis 2 (Fluorescent)" data={rd2} envName="REDIS_URL_2" />

        {/* Redis 3 (Mesago) */}
        <RedisMetricCard title="Redis Mesago" data={rd3} envName="REDIS_MESAGO_URL" />

        {/* Redis 4 (Mesago 2 - optional) */}
        {hasRd4 && (
          <RedisMetricCard title="Redis Mesago 2" data={rd4} envName="REDIS_MESAGO_URL_2" />
        )}
      </div>
    </div>
  );
}
