import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Plus,
  Send,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  createAlertChannel,
  createAlertRule,
  deleteAlertChannel,
  deleteAlertRule,
  getAlertChannels,
  getAlertDeliveries,
  getAlertRules,
  getMonitors,
} from '../services/api';
import type {
  AlertChannel,
  AlertChannelKind,
  AlertDelivery,
  AlertMetric,
  AlertOperator,
  AlertRule,
  Monitor,
} from '../types';
import { useLiveData } from '../hooks/useLiveData';

const CHANNEL_KINDS: AlertChannelKind[] = [
  'telegram',
  'whatsapp',
  'email',
  'slack',
  'webhook',
  'discord',
  'teams',
];

const METRICS: Array<{ value: AlertMetric; label: string }> = [
  { value: 'status_down', label: 'Monitor down' },
  { value: 'status_up', label: 'Monitor recovered' },
  { value: 'latency_ms', label: 'Latency (ms)' },
  { value: 'http_status', label: 'HTTP status' },
  { value: 'ssl_days_remaining', label: 'SSL days remaining' },
];

const OPERATORS: AlertOperator[] = ['>', '>=', '<', '<=', '==', '!='];

export const AlertsPage: React.FC = () => {
  const [tab, setTab] = useState<'rules' | 'channels' | 'deliveries'>('rules');
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [deliveries, setDeliveries] = useState<AlertDelivery[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);

  const [channelForm, setChannelForm] = useState({
    name: '',
    kind: 'telegram' as AlertChannelKind,
    bot_token: '',
    chat_id: '',
    phone: '',
    api_key: '',
    to: '',
    url: '',
  });

  const [ruleForm, setRuleForm] = useState({
    name: '',
    metric: 'status_down' as AlertMetric,
    operator: '==' as AlertOperator,
    threshold: '500',
    for_seconds: '0',
    cooldown_seconds: '900',
    monitor_id: '',
    channel_ids: [] as string[],
  });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [ch, rl, dl, mons] = await Promise.all([
        getAlertChannels(),
        getAlertRules(),
        getAlertDeliveries(),
        getMonitors(),
      ]);
      setChannels(ch);
      setRules(rl);
      setDeliveries(dl);
      setMonitors(mons);
      setError('');
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar alertas');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useLiveData(() => load(true), !loading);

  // Polling silencioso em tempo real para auditoria de entregas da fila MesaGo
  useEffect(() => {
    if (tab !== 'deliveries') return;
    const interval = setInterval(async () => {
      try {
        const dl = await getAlertDeliveries();
        setDeliveries(dl);
      } catch {
        // atualização silenciosa
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [tab]);

  async function handleCreateChannel(e: React.FormEvent) {
    e.preventDefault();
    const config: Record<string, unknown> = {};
    if (channelForm.kind === 'telegram') {
      config.bot_token = channelForm.bot_token;
      config.chat_id = channelForm.chat_id;
    } else if (channelForm.kind === 'whatsapp') {
      config.phone = channelForm.phone;
      config.api_key = channelForm.api_key;
    } else if (channelForm.kind === 'email') {
      config.to = channelForm.to;
    } else {
      config.url = channelForm.url;
    }

    try {
      await createAlertChannel({
        name: channelForm.name,
        kind: channelForm.kind,
        config,
      });
      setShowChannelForm(false);
      setChannelForm({
        name: '',
        kind: 'telegram',
        bot_token: '',
        chat_id: '',
        phone: '',
        api_key: '',
        to: '',
        url: '',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar canal');
    }
  }

  async function handleCreateRule(e: React.FormEvent) {
    e.preventDefault();
    if (ruleForm.channel_ids.length === 0) {
      setError('Selecione ao menos um canal');
      return;
    }
    try {
      await createAlertRule({
        name: ruleForm.name,
        metric: ruleForm.metric,
        operator: ruleForm.operator,
        threshold:
          ruleForm.metric === 'status_down' || ruleForm.metric === 'status_up'
            ? null
            : Number(ruleForm.threshold),
        for_seconds: Number(ruleForm.for_seconds) || 0,
        cooldown_seconds: Number(ruleForm.cooldown_seconds) || 900,
        monitor_id: ruleForm.monitor_id || null,
        channels: ruleForm.channel_ids.map((id, index) => ({
          channel_id: id,
          escalation_step: index,
          delay_seconds: index === 0 ? 0 : 300 * index,
        })),
      });
      setShowRuleForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar regra');
    }
  }

  function toggleChannel(id: string) {
    setRuleForm((f) => ({
      ...f,
      channel_ids: f.channel_ids.includes(id)
        ? f.channel_ids.filter((x) => x !== id)
        : [...f.channel_ids, id],
    }));
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Alert Engine</h1>
          <p className="page-subtitle">
            Regras, canais, cooldown, retry e escalonamento
          </p>
        </div>
        <div className="page-header__actions">
          {tab === 'channels' && (
            <button className="btn btn-primary" onClick={() => setShowChannelForm(true)}>
              <Plus size={14} /> Canal
            </button>
          )}
          {tab === 'rules' && (
            <button className="btn btn-primary" onClick={() => setShowRuleForm(true)}>
              <Plus size={14} /> Regra
            </button>
          )}
        </div>
      </div>

      <div className="filter-tabs">
        {(
          [
            { id: 'rules', label: 'Regras' },
            { id: 'channels', label: 'Canais' },
            { id: 'deliveries', label: 'Histórico de Notificações' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert--error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className="skeleton" style={{ height: 160, borderRadius: 14 }} />
      ) : tab === 'channels' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {channels.length === 0 && (
            <div className="glass" style={{ padding: 32, textAlign: 'center' }}>
              <Bell size={24} style={{ marginBottom: 8 }} />
              <p style={{ color: 'var(--text-muted)' }}>Nenhum canal ainda. Crie Telegram, Slack, Webhook…</p>
            </div>
          )}
          {channels.map((ch) => (
            <div key={ch.id} className="glass channel-row" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{ch.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {ch.kind} · {ch.is_enabled ? 'ativo' : 'pausado'}
                </div>
              </div>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await deleteAlertChannel(ch.id);
                  await load();
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : tab === 'rules' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rules.length === 0 && (
            <div className="glass" style={{ padding: 32, textAlign: 'center' }}>
              <Zap size={24} style={{ marginBottom: 8 }} />
              <p style={{ color: 'var(--text-muted)' }}>
                Ex.: IF latency &gt; 500ms FOR 5 min THEN Telegram + Slack
              </p>
            </div>
          )}
          {rules.map((rule) => (
            <div key={rule.id} className="glass" style={{ padding: 16 }}>
              <div className="rule-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, wordBreak: 'break-word' }}>{rule.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                    IF <code>{rule.metric}</code> {rule.operator}{' '}
                    {rule.threshold ?? '—'}
                    {rule.for_seconds > 0 ? ` FOR ${Math.round(rule.for_seconds / 60)} min` : ''}
                    {' '}THEN {rule.channels.map((c) => c.channel?.name || c.channel_id.slice(0, 6)).join(' + ')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    cooldown {rule.cooldown_seconds}s · retry {rule.max_retries} ·{' '}
                    {rule.is_enabled ? 'ativa' : 'pausada'}
                    {rule.monitor_id
                      ? ` · monitor ${monitors.find((m) => m.id === rule.monitor_id)?.name || rule.monitor_id.slice(0, 8)}`
                      : ' · todos os monitores'}
                  </div>
                </div>
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    await deleteAlertRule(rule.id);
                    await load();
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            className="glass"
            style={{
              padding: '16px 20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              borderLeft: '4px solid #10b981',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Histórico de Notificações</h2>
                <span
                  className="badge badge-up"
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    fontWeight: 600,
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: '#10b981',
                      display: 'inline-block',
                      boxShadow: '0 0 8px #10b981',
                      animation: 'pulse 1.8s infinite',
                    }}
                  />
                  Tempo Real (MesaGo Queue)
                </span>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                Auditoria dos últimos envios processados pela fila assíncrona do MesaGo.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {deliveries.length} {deliveries.length === 1 ? 'notificação auditada' : 'notificações auditadas'}
              </span>
            </div>
          </div>

          {deliveries.length === 0 ? (
            <div className="glass" style={{ padding: 40, textAlign: 'center' }}>
              <Send size={28} style={{ marginBottom: 10, opacity: 0.5, color: 'var(--text-muted)' }} />
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Nenhuma notificação registrada</div>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
                Os alertas disparados e processados pela fila assíncrona do MesaGo aparecerão aqui silenciosamente em tempo real.
              </p>
            </div>
          ) : (
            deliveries.map((d) => {
              const channel = channels.find((c) => c.id === d.channel_id);
              const rule = rules.find((r) => r.id === d.rule_id);
              const monitor = monitors.find((m) => m.id === d.monitor_id);

              const statusBadge =
                d.status === 'sent' ? (
                  <span className="badge badge-up">
                    <CheckCircle2 size={12} /> Enviado
                  </span>
                ) : d.status === 'failed' ? (
                  <span className="badge badge-down">
                    <XCircle size={12} /> Falha no Envio
                  </span>
                ) : d.status === 'pending' ? (
                  <span
                    className="badge"
                    style={{
                      background: 'rgba(234, 179, 8, 0.15)',
                      color: '#eab308',
                      border: '1px solid rgba(234, 179, 8, 0.3)',
                    }}
                  >
                    <Clock size={12} /> Na Fila MesaGo
                  </span>
                ) : (
                  <span className="badge badge-unknown">
                    <AlertTriangle size={12} /> Suprimido
                  </span>
                );

              return (
                <div
                  key={d.id}
                  className="glass"
                  style={{
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      {statusBadge}
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {channel ? channel.name : `Canal: ${d.channel_id.slice(0, 8)}`}
                      </span>
                      {channel?.kind && (
                        <span
                          className="badge"
                          style={{
                            fontSize: 11,
                            padding: '1px 6px',
                            background: 'rgba(255, 255, 255, 0.06)',
                          }}
                        >
                          {channel.kind.toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {new Date(d.fired_at || d.created_at).toLocaleString('pt-BR')}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 16,
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Regra: </span>
                      <strong>{rule ? rule.name : d.rule_id.slice(0, 8)}</strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Monitor: </span>
                      <strong>
                        {monitor ? monitor.name : d.monitor_id ? d.monitor_id.slice(0, 8) : 'Geral (Global)'}
                      </strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Tentativa: </span>
                      <span>#{d.attempt || 1}</span>
                    </div>

                    {d.escalation_step > 0 && (
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Escalonamento: </span>
                        <span>Passo {d.escalation_step + 1}</span>
                      </div>
                    )}
                  </div>

                  {d.last_error && (
                    <div
                      style={{
                        padding: '8px 12px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        borderRadius: 6,
                        color: '#f87171',
                        fontSize: 12,
                        wordBreak: 'break-word',
                        fontFamily: 'monospace',
                      }}
                    >
                      <strong>Erro retornado:</strong> {d.last_error}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {showChannelForm && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowChannelForm(false)}>
          <div className="modal">
            <h2 className="modal__title">Novo canal</h2>
            <form onSubmit={handleCreateChannel} className="modal__form">
              <div className="form-group">
                <label className="form-label">Nome</label>
                <input className="input" value={channelForm.name} onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Tipo</label>
                <select className="input" value={channelForm.kind} onChange={(e) => setChannelForm({ ...channelForm, kind: e.target.value as AlertChannelKind })}>
                  {CHANNEL_KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              {channelForm.kind === 'telegram' && (
                <>
                  <div className="form-group">
                    <label className="form-label">Bot token</label>
                    <input className="input" value={channelForm.bot_token} onChange={(e) => setChannelForm({ ...channelForm, bot_token: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Chat ID</label>
                    <input className="input" value={channelForm.chat_id} onChange={(e) => setChannelForm({ ...channelForm, chat_id: e.target.value })} required />
                  </div>
                </>
              )}
              {channelForm.kind === 'whatsapp' && (
                <>
                  <div className="form-group">
                    <label className="form-label">Phone</label>
                    <input className="input" value={channelForm.phone} onChange={(e) => setChannelForm({ ...channelForm, phone: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">API key</label>
                    <input className="input" value={channelForm.api_key} onChange={(e) => setChannelForm({ ...channelForm, api_key: e.target.value })} required />
                  </div>
                </>
              )}
              {channelForm.kind === 'email' && (
                <div className="form-group">
                  <label className="form-label">To</label>
                  <input className="input" type="email" value={channelForm.to} onChange={(e) => setChannelForm({ ...channelForm, to: e.target.value })} required />
                </div>
              )}
              {['webhook', 'slack', 'discord', 'teams'].includes(channelForm.kind) && (
                <div className="form-group">
                  <label className="form-label">Webhook URL</label>
                  <input className="input" value={channelForm.url} onChange={(e) => setChannelForm({ ...channelForm, url: e.target.value })} required />
                </div>
              )}
              <div className="modal__actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowChannelForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Criar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRuleForm && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowRuleForm(false)}>
          <div className="modal" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 className="modal__title">Nova regra</h2>
            <form onSubmit={handleCreateRule} className="modal__form">
              <div className="form-group">
                <label className="form-label">Nome</label>
                <input className="input" value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Monitor (opcional)</label>
                <select className="input" value={ruleForm.monitor_id} onChange={(e) => setRuleForm({ ...ruleForm, monitor_id: e.target.value })}>
                  <option value="">Todos</option>
                  {monitors.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div className="modal-form-grid">
                <div className="form-group">
                  <label className="form-label">Métrica</label>
                  <select className="input" value={ruleForm.metric} onChange={(e) => setRuleForm({ ...ruleForm, metric: e.target.value as AlertMetric })}>
                    {METRICS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Operador</label>
                  <select className="input" value={ruleForm.operator} onChange={(e) => setRuleForm({ ...ruleForm, operator: e.target.value as AlertOperator })}>
                    {OPERATORS.map((op) => (
                      <option key={op} value={op}>{op}</option>
                    ))}
                  </select>
                </div>
              </div>
              {(ruleForm.metric === 'latency_ms' || ruleForm.metric === 'http_status') && (
                <div className="form-group">
                  <label className="form-label">Threshold</label>
                  <input className="input" type="number" value={ruleForm.threshold} onChange={(e) => setRuleForm({ ...ruleForm, threshold: e.target.value })} />
                </div>
              )}
              <div className="modal-form-grid">
                <div className="form-group">
                  <label className="form-label">FOR (segundos)</label>
                  <input className="input" type="number" min={0} value={ruleForm.for_seconds} onChange={(e) => setRuleForm({ ...ruleForm, for_seconds: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Cooldown (segundos)</label>
                  <input className="input" type="number" min={0} value={ruleForm.cooldown_seconds} onChange={(e) => setRuleForm({ ...ruleForm, cooldown_seconds: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Canais (ordem = escalonamento)</label>
                {channels.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Crie um canal primeiro.</p>
                ) : (
                  channels.map((ch) => (
                    <label key={ch.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 14 }}>
                      <input
                        type="checkbox"
                        checked={ruleForm.channel_ids.includes(ch.id)}
                        onChange={() => toggleChannel(ch.id)}
                      />
                      {ch.name} ({ch.kind})
                    </label>
                  ))
                )}
              </div>
              <div className="modal__actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowRuleForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Criar regra</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
