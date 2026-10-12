import crypto from 'crypto';
import type {
  CreateRumSiteInput,
  RumEvent,
  RumEventInput,
  RumEventType,
  RumOverview,
  RumSite,
  RumSiteCreated,
  RumVitalStat,
} from '@analytic-pulse/shared';
import { NotFoundError, ValidationError } from '@analytic-pulse/shared';
import { query } from '../../../infrastructure/db';
import { logger } from '../../../observability/logger';

export const DEFAULT_DASHBOARD_RUM_TOKEN = 'ap_rum_2JOpr7gSzi0un4UwQ-nGW5rtZXIhgzvy';

export async function ensureDefaultRumSite(): Promise<void> {
  try {
    // Garante que as tabelas de RUM existam no Postgres
    await query(`
      CREATE TABLE IF NOT EXISTS rum_sites (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name            VARCHAR(120) NOT NULL,
        origin_allow    VARCHAR(500),
        token_hash      VARCHAR(64) NOT NULL UNIQUE,
        token_prefix    VARCHAR(16) NOT NULL,
        last_seen_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
      );
      CREATE INDEX IF NOT EXISTS idx_rum_sites_user ON rum_sites(user_id);
      CREATE INDEX IF NOT EXISTS idx_rum_sites_token_hash ON rum_sites(token_hash);

      CREATE TABLE IF NOT EXISTS rum_events (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        site_id         UUID NOT NULL REFERENCES rum_sites(id) ON DELETE CASCADE,
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_type      VARCHAR(40) NOT NULL,
        name            VARCHAR(200),
        value           DOUBLE PRECISION,
        url             TEXT,
        path            TEXT,
        referrer        TEXT,
        user_agent      TEXT,
        session_id      VARCHAR(64),
        meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
      );
      CREATE INDEX IF NOT EXISTS idx_rum_events_user_created ON rum_events(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rum_events_site_created ON rum_events(site_id, created_at DESC);
    `);

    const userRes = await query(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`);
    if (userRes.rows.length === 0) return;

    const userId = userRes.rows[0].id as string;
    const hash = crypto.createHash('sha256').update(DEFAULT_DASHBOARD_RUM_TOKEN).digest('hex');

    await query(
      `INSERT INTO rum_sites (user_id, name, origin_allow, token_hash, token_prefix)
       VALUES ($1, 'analytic-pulse', NULL, $2, $3)
       ON CONFLICT (token_hash) DO NOTHING`,
      [userId, hash, DEFAULT_DASHBOARD_RUM_TOKEN.slice(0, 12)]
    );
    logger.info('Default RUM site verified/provisioned');
  } catch (err) {
    logger.warn('Could not verify/provision default RUM site', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const VALID_TYPES: RumEventType[] = ['page_view', 'web_vital', 'error', 'custom'];
const MAX_BATCH = 50;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken(): { token: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(24).toString('base64url');
  const token = `ap_rum_${raw}`;
  return {
    token,
    prefix: token.slice(0, 12),
    hash: hashToken(token),
  };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return new Date(value).toISOString();
}

function mapSite(row: Record<string, unknown>): RumSite {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    name: row.name as string,
    origin_allow: (row.origin_allow as string | null) ?? null,
    token_prefix: row.token_prefix as string,
    last_seen_at: toIso(row.last_seen_at as Date | string | null),
    created_at: toIso(row.created_at as Date | string)!,
    updated_at: toIso(row.updated_at as Date | string)!,
    events_24h:
      row.events_24h != null ? Number(row.events_24h) : undefined,
  };
}

function mapEvent(row: Record<string, unknown>): RumEvent {
  return {
    id: row.id as string,
    site_id: row.site_id as string,
    user_id: row.user_id as string,
    event_type: row.event_type as RumEventType,
    name: (row.name as string | null) ?? null,
    value: row.value != null ? Number(row.value) : null,
    url: (row.url as string | null) ?? null,
    path: (row.path as string | null) ?? null,
    referrer: (row.referrer as string | null) ?? null,
    user_agent: (row.user_agent as string | null) ?? null,
    session_id: (row.session_id as string | null) ?? null,
    meta: (row.meta as Record<string, unknown>) || {},
    created_at: toIso(row.created_at as Date | string)!,
  };
}

function originAllowed(allow: string | null | undefined, origin: string | null): boolean {
  if (!allow?.trim()) return true;
  if (!origin) return true;
  const pattern = allow.trim().toLowerCase().replace(/\/$/, '');
  const o = origin.trim().toLowerCase().replace(/\/$/, '');
  return o === pattern || o.startsWith(`${pattern}/`);
}

export class RumService {
  async createSite(
    userId: string,
    input: CreateRumSiteInput
  ): Promise<RumSiteCreated> {
    if (!input.name?.trim()) throw new ValidationError('name is required');
    const { token, prefix, hash } = generateToken();
    const origin = input.origin_allow?.trim() || null;

    const result = await query(
      `INSERT INTO rum_sites (user_id, name, origin_allow, token_hash, token_prefix)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, input.name.trim(), origin, hash, prefix]
    );
    const site = mapSite(result.rows[0] as Record<string, unknown>);
    return { ...site, token };
  }

  async listSites(userId: string): Promise<RumSite[]> {
    const result = await query(
      `SELECT s.*,
              (
                SELECT COUNT(*)::int FROM rum_events e
                WHERE e.site_id = s.id
                  AND e.created_at > NOW() - INTERVAL '24 hours'
              ) AS events_24h
       FROM rum_sites s
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC`,
      [userId]
    );
    return (result.rows as Record<string, unknown>[]).map(mapSite);
  }

  async deleteSite(userId: string, siteId: string): Promise<void> {
    const result = await query(
      `DELETE FROM rum_sites WHERE id = $1 AND user_id = $2 RETURNING id`,
      [siteId, userId]
    );
    if (result.rowCount === 0) throw new NotFoundError('RUM site');
  }

  async findByToken(token: string): Promise<RumSite | null> {
    if (!token.startsWith('ap_rum_')) return null;
    const hash = hashToken(token);
    try {
      const result = await query(
        `SELECT * FROM rum_sites WHERE token_hash = $1`,
        [hash]
      );
      if (result.rows.length > 0) {
        return mapSite(result.rows[0] as Record<string, unknown>);
      }
    } catch {
      // Se a tabela ainda não existir no banco, tenta auto-provisionar abaixo
    }

    // Auto-provision do token padrão do dashboard caso ainda não exista no banco
    if (token === DEFAULT_DASHBOARD_RUM_TOKEN) {
      try {
        await ensureDefaultRumSite();
        const result = await query(
          `SELECT * FROM rum_sites WHERE token_hash = $1`,
          [hash]
        );
        if (result.rows.length > 0) {
          return mapSite(result.rows[0] as Record<string, unknown>);
        }
      } catch (err) {
        logger.error('Failed to auto-provision default RUM site on token lookup', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return null;
  }

  async ingest(
    site: RumSite,
    events: RumEventInput[],
    opts: { userAgent?: string | null; origin?: string | null }
  ): Promise<{ accepted: number }> {
    if (!originAllowed(site.origin_allow, opts.origin ?? null)) {
      throw new ValidationError('Origin not allowed for this RUM site');
    }
    if (!Array.isArray(events) || events.length === 0) {
      throw new ValidationError('events array is required');
    }
    if (events.length > MAX_BATCH) {
      throw new ValidationError(`Max ${MAX_BATCH} events per request`);
    }

    const ua = (opts.userAgent || '').slice(0, 500) || null;
    let accepted = 0;

    for (const ev of events) {
      if (!ev || !VALID_TYPES.includes(ev.type)) continue;
      const name = ev.name?.trim().slice(0, 200) || null;
      const value =
        typeof ev.value === 'number' && Number.isFinite(ev.value)
          ? ev.value
          : null;
      const url = ev.url?.slice(0, 2000) || null;
      const path = ev.path?.slice(0, 500) || null;
      const referrer = ev.referrer?.slice(0, 1000) || null;
      const sessionId = ev.session_id?.slice(0, 64) || null;
      const meta =
        ev.meta && typeof ev.meta === 'object' && !Array.isArray(ev.meta)
          ? ev.meta
          : {};

      await query(
        `INSERT INTO rum_events
           (site_id, user_id, event_type, name, value, url, path, referrer, user_agent, session_id, meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [
          site.id,
          site.user_id,
          ev.type,
          name,
          value,
          url,
          path,
          referrer,
          ua,
          sessionId,
          JSON.stringify(meta),
        ]
      );
      accepted += 1;
    }

    if (accepted > 0) {
      await query(
        `UPDATE rum_sites
         SET last_seen_at = TIMEZONE('utc', NOW()),
             updated_at = TIMEZONE('utc', NOW())
         WHERE id = $1`,
        [site.id]
      );
    }

    return { accepted };
  }

  async overview(userId: string): Promise<RumOverview> {
    const sites = await this.listSites(userId);

    const summaryResult = await query(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'page_view')::int AS page_views_24h,
         COUNT(*) FILTER (WHERE event_type = 'error')::int AS errors_24h,
         COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL)::int AS sessions_24h
       FROM rum_events
       WHERE user_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    const s = (summaryResult.rows[0] || {}) as Record<string, unknown>;

    const vitalsResult = await query(
      `SELECT
         name,
         COUNT(*)::int AS count,
         ROUND(AVG(value)::numeric, 2)::float AS avg,
         ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value))::numeric, 2)::float AS p50,
         ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY value))::numeric, 2)::float AS p75,
         ROUND((PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value))::numeric, 2)::float AS p95
       FROM rum_events
       WHERE user_id = $1
         AND event_type = 'web_vital'
         AND name IS NOT NULL
         AND value IS NOT NULL
         AND created_at > NOW() - INTERVAL '7 days'
       GROUP BY name
       ORDER BY name`,
      [userId]
    );

    const vitals: RumVitalStat[] = (
      vitalsResult.rows as Record<string, unknown>[]
    ).map((row) => ({
      name: row.name as string,
      count: Number(row.count),
      avg: row.avg != null ? Number(row.avg) : null,
      p50: row.p50 != null ? Number(row.p50) : null,
      p75: row.p75 != null ? Number(row.p75) : null,
      p95: row.p95 != null ? Number(row.p95) : null,
    }));

    const errorsResult = await query(
      `SELECT * FROM rum_events
       WHERE user_id = $1 AND event_type = 'error'
       ORDER BY created_at DESC
       LIMIT 25`,
      [userId]
    );

    return {
      sites,
      summary: {
        sites: sites.length,
        page_views_24h: Number(s.page_views_24h || 0),
        errors_24h: Number(s.errors_24h || 0),
        sessions_24h: Number(s.sessions_24h || 0),
      },
      vitals,
      recent_errors: (errorsResult.rows as Record<string, unknown>[]).map(
        mapEvent
      ),
    };
  }

  async listEvents(
    userId: string,
    opts?: { siteId?: string; type?: RumEventType; limit?: number }
  ): Promise<RumEvent[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const params: unknown[] = [userId];
    let sql = `SELECT * FROM rum_events WHERE user_id = $1`;
    if (opts?.siteId) {
      params.push(opts.siteId);
      sql += ` AND site_id = $${params.length}`;
    }
    if (opts?.type && VALID_TYPES.includes(opts.type)) {
      params.push(opts.type);
      sql += ` AND event_type = $${params.length}`;
    }
    params.push(limit);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    const result = await query(sql, params);
    return (result.rows as Record<string, unknown>[]).map(mapEvent);
  }
}
