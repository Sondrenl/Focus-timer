import { signJwt, verifyJwt, verifyGoogleToken } from './auth';

interface Env {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  GOOGLE_CLIENT_ID?: string;
  AUTH_SECRET?: string;
}

export interface PeerPresence {
  desktopActive: boolean;
  desktopVisible: boolean;
  mobileActive: boolean;
  mobileVisible: boolean;
}

// In production, AUTH_SECRET must be set via Cloudflare Workers Secrets
// (`wrangler secret put AUTH_SECRET` or via Cloudflare Dashboard -> Variables and Secrets).
// A local fallback is used strictly for development/testing when secrets are not yet injected.
const DEV_FALLBACK_AUTH_SECRET = 'dev-local-secret-do-not-use-in-production';
const DEFAULT_CLIENT_ID = '229654613287-8utvd3fhrcsalh1ol02ev2mlg140kbai.apps.googleusercontent.com';

const DESKTOP_PRESENCE_TTL_MS = 4500;
const MOBILE_PRESENCE_TTL_MS = 6000;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (\n    id TEXT PRIMARY KEY,\n    google_id TEXT UNIQUE NOT NULL,\n    email TEXT NOT NULL,\n    display_name TEXT,\n    avatar_url TEXT,\n    avatar_emoji TEXT DEFAULT '',\n    daily_goal_minutes INTEGER DEFAULT 120,\n    created_at TEXT DEFAULT CURRENT_TIMESTAMP,\n    updated_at TEXT DEFAULT CURRENT_TIMESTAMP\n  )`,
  `CREATE TABLE IF NOT EXISTS tags (\n    id TEXT NOT NULL,\n    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    name TEXT NOT NULL,\n    color TEXT NOT NULL,\n    is_archived INTEGER DEFAULT 0,\n    created_at TEXT DEFAULT CURRENT_TIMESTAMP,\n    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,\n    PRIMARY KEY (user_id, id)\n  )`,
  `CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_user_id ON tags(user_id, id)`,
  `CREATE TABLE IF NOT EXISTS deleted_tags (\n    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    tag_id TEXT NOT NULL,\n    deleted_at TEXT DEFAULT CURRENT_TIMESTAMP,\n    PRIMARY KEY (user_id, tag_id)\n  )`,
  `CREATE INDEX IF NOT EXISTS idx_deleted_tags_user ON deleted_tags(user_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (\n    id TEXT PRIMARY KEY,\n    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    tag_id TEXT,\n    session_type TEXT NOT NULL CHECK(session_type IN ('WORK', 'SHORT_BREAK', 'LONG_BREAK')),\n    duration_seconds INTEGER NOT NULL,\n    completed_at TEXT NOT NULL\n  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, completed_at)`,
  `CREATE TABLE IF NOT EXISTS coffee_cups (\n    id TEXT PRIMARY KEY,\n    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    tag_id TEXT,\n    date TEXT NOT NULL,\n    created_at TEXT DEFAULT CURRENT_TIMESTAMP\n  )`,
  `CREATE INDEX IF NOT EXISTS idx_coffee_cups_user_date ON coffee_cups(user_id, date)`,
  `CREATE TABLE IF NOT EXISTS user_settings (\n    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,\n    work_duration_minutes INTEGER DEFAULT 25,\n    short_break_duration_minutes INTEGER DEFAULT 5,\n    long_break_duration_minutes INTEGER DEFAULT 25,\n    long_break_interval INTEGER DEFAULT 4,\n    auto_start_breaks INTEGER DEFAULT 0,\n    auto_start_pomodoros INTEGER DEFAULT 0,\n    sound_enabled INTEGER DEFAULT 1,\n    sound_volume REAL DEFAULT 0.8,\n    notifications_enabled INTEGER DEFAULT 0,\n    keep_awake INTEGER DEFAULT 0,\n    updated_at TEXT DEFAULT CURRENT_TIMESTAMP\n  )`,
  `CREATE TABLE IF NOT EXISTS active_timers (\n    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,\n    session_type TEXT NOT NULL,\n    status TEXT NOT NULL,\n    remaining_seconds INTEGER NOT NULL,\n    total_seconds INTEGER NOT NULL,\n    target_end_time INTEGER,\n    current_cycle INTEGER NOT NULL,\n    tag_id TEXT,\n    timer_run_id TEXT,\n    updated_at_ms INTEGER NOT NULL,\n    last_heartbeat_ms INTEGER\n  )`,
  `CREATE TABLE IF NOT EXISTS deleted_coffee_cups (\n    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    cup_id TEXT NOT NULL,\n    deleted_at TEXT DEFAULT CURRENT_TIMESTAMP,\n    PRIMARY KEY (user_id, cup_id)\n  )`,
  `CREATE INDEX IF NOT EXISTS idx_deleted_coffee_cups_user ON deleted_coffee_cups(user_id)`,
  `CREATE TABLE IF NOT EXISTS user_device_presence (\n    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    device_id TEXT NOT NULL,\n    device_type TEXT NOT NULL,\n    is_visible INTEGER DEFAULT 0,\n    last_seen_ms INTEGER NOT NULL,\n    PRIMARY KEY (user_id, device_id)\n  )`,
  `CREATE INDEX IF NOT EXISTS idx_device_presence_user ON user_device_presence(user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_device_presence ON user_device_presence(user_id, device_id)`,
];

let isSchemaEnsured = false;

async function ensureSchema(db: D1Database): Promise<void> {
  if (isSchemaEnsured) return;
  try {
    await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
  } catch {
    for (const sql of SCHEMA_STATEMENTS) {
      try {
        await db.prepare(sql).run();
      } catch (err) {
        console.error('Error ensuring schema statement:', err);
      }
    }
  }

  // Ensure tags table has compound PRIMARY KEY (user_id, id) for multi-tenant safety
  try {
    const tableInfo = await db.prepare('PRAGMA table_info(tags)').all<{ name: string; pk: number }>();
    const userIdCol = (tableInfo.results || []).find((col) => col.name === 'user_id');
    if (userIdCol && userIdCol.pk === 0) {
      await db.batch([
        db.prepare('PRAGMA defer_foreign_keys = ON'),
        db.prepare('DROP TABLE IF EXISTS tags_new'),
        db.prepare(`CREATE TABLE IF NOT EXISTS tags_new (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          color TEXT NOT NULL,
          is_archived INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, id)
        )`),
        db.prepare(`INSERT OR IGNORE INTO tags_new (id, user_id, name, color, is_archived, created_at, updated_at)
          SELECT id, user_id, name, color, is_archived, created_at, updated_at FROM tags`),
        db.prepare('DROP TABLE tags'),
        db.prepare('ALTER TABLE tags_new RENAME TO tags'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id)'),
        db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_user_id ON tags(user_id, id)'),
        db.prepare('PRAGMA defer_foreign_keys = OFF'),
      ]);
    }
  } catch (migErr) {
    console.warn('Tags PK migration check:', migErr);
  }

  isSchemaEnsured = true;
}

async function updateAndGetPeerPresence(
  db: D1Database,
  userId: string,
  request: Request,
  now: number
): Promise<PeerPresence> {
  const deviceId = (request.headers.get('X-Device-Id') || '').trim();
  const rawType = (request.headers.get('X-Device-Type') || '').trim().toLowerCase();
  const deviceType = rawType === 'mobile' ? 'mobile' : 'desktop';
  const isVisible = request.headers.get('X-Device-Visible') === '1' ? 1 : 0;
  const isClosed = request.headers.get('X-Device-Closed') === '1';

  try {
    if (deviceId) {
      if (isClosed) {
        await db
          .prepare('DELETE FROM user_device_presence WHERE user_id = ? AND device_id = ?')
          .bind(userId, deviceId)
          .run();
      } else {
        const statements: D1PreparedStatement[] = [
          db
            .prepare(
              `INSERT INTO user_device_presence (user_id, device_id, device_type, is_visible, last_seen_ms)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id, device_id) DO UPDATE SET
                 device_type = excluded.device_type,
                 is_visible = excluded.is_visible,
                 last_seen_ms = excluded.last_seen_ms`
            )
            .bind(userId, deviceId, deviceType, isVisible, now),
        ];

        // Prune presence records older than 1 hour occasionally (5% probability) to minimize D1 write volume
        if (Math.random() < 0.05) {
          statements.push(
            db
              .prepare('DELETE FROM user_device_presence WHERE user_id = ? AND last_seen_ms < ?')
              .bind(userId, now - 3600000)
          );
        }

        await db.batch(statements);
      }
    }

    const rows = await db
      .prepare('SELECT device_id, device_type, is_visible, last_seen_ms FROM user_device_presence WHERE user_id = ?')
      .bind(userId)
      .all<{
        device_id: string;
        device_type: string;
        is_visible: number;
        last_seen_ms: number;
      }>();

    let desktopActive = false;
    let desktopVisible = false;
    let mobileActive = false;
    let mobileVisible = false;

    for (const r of rows.results || []) {
      const ageMs = Math.max(0, now - r.last_seen_ms);
      if (r.device_type === 'desktop') {
        if (ageMs <= DESKTOP_PRESENCE_TTL_MS) {
          desktopActive = true;
          if (r.is_visible === 1) {
            desktopVisible = true;
          }
        }
      } else if (r.device_type === 'mobile') {
        if (ageMs <= MOBILE_PRESENCE_TTL_MS) {
          mobileActive = true;
          if (r.is_visible === 1) {
            mobileVisible = true;
          }
        }
      }
    }

    return {
      desktopActive,
      desktopVisible,
      mobileActive,
      mobileVisible,
    };
  } catch (err) {
    console.warn('Error updating device presence:', err);
    return {
      desktopActive: false,
      desktopVisible: false,
      mobileActive: false,
      mobileVisible: false,
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route API requests
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    // Serve static SPA assets
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Timer-Heartbeat, X-Device-Id, X-Device-Type, X-Device-Visible, X-Device-Closed',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authSecret = env.AUTH_SECRET || DEV_FALLBACK_AUTH_SECRET;
  if (!env.AUTH_SECRET) {
    console.warn(
      'AUTH_SECRET is not configured in worker environment. Please set it using `wrangler secret put AUTH_SECRET` or in Cloudflare Dashboard.'
    );
  }
  const googleClientId = env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;

  try {
    // Health check endpoint
    if (url.pathname === '/api/health') {
      let dbStatus = 'connected';
      let tablesReady = false;
      try {
        if (!env.DB) {
          dbStatus = 'error: D1 database binding missing';
        } else {
          await ensureSchema(env.DB);
          await env.DB.prepare('SELECT count(*) FROM deleted_tags').first();
          await env.DB.prepare('SELECT count(*) FROM active_timers').first();
          tablesReady = true;
        }
      } catch (err) {
        dbStatus = `error: ${(err as Error).message}`;
      }

      return new Response(
        JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          database: dbStatus,
          tablesReady,
        }),
        { headers: corsHeaders }
      );
    }

    if (!env.DB) {
      return new Response(
        JSON.stringify({ error: 'Database service is unavailable' }),
        { status: 503, headers: corsHeaders }
      );
    }

    await ensureSchema(env.DB);

    // POST /api/auth/google — Verify Google ID Token & Upsert User
    if (url.pathname === '/api/auth/google' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { idToken?: string };
      if (!body.idToken) {
        return new Response(JSON.stringify({ error: 'Missing idToken' }), { status: 400, headers: corsHeaders });
      }

      const googleUser = await verifyGoogleToken(body.idToken, googleClientId);

      // Check if user already exists
      const existingUser = await env.DB.prepare('SELECT * FROM users WHERE google_id = ?')
        .bind(googleUser.googleId)
        .first<{
          id: string;
          google_id: string;
          email: string;
          display_name: string;
          avatar_url: string;
          avatar_emoji: string;
          daily_goal_minutes: number;
          created_at: string;
        }>();

      let userRecord: {
        id: string;
        email: string;
        displayName: string;
        avatarUrl: string;
        avatarEmoji: string;
        dailyGoalMinutes: number;
        createdAt: string;
      };

      if (existingUser) {
        await env.DB.prepare(
          'UPDATE users SET email = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE google_id = ?'
        )
          .bind(googleUser.email, googleUser.avatarUrl, googleUser.googleId)
          .run();

        userRecord = {
          id: existingUser.id,
          email: googleUser.email,
          displayName: existingUser.display_name || googleUser.displayName,
          avatarUrl: googleUser.avatarUrl || existingUser.avatar_url,
          avatarEmoji: existingUser.avatar_emoji || '',
          dailyGoalMinutes: existingUser.daily_goal_minutes || 120,
          createdAt: existingUser.created_at,
        };
      } else {
        const newId = crypto.randomUUID();
        const now = new Date().toISOString();
        await env.DB.prepare(
          'INSERT INTO users (id, google_id, email, display_name, avatar_url, avatar_emoji, daily_goal_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
          .bind(
            newId,
            googleUser.googleId,
            googleUser.email,
            googleUser.displayName,
            googleUser.avatarUrl,
            '',
            120,
            now,
            now
          )
          .run();

        userRecord = {
          id: newId,
          email: googleUser.email,
          displayName: googleUser.displayName,
          avatarUrl: googleUser.avatarUrl,
          avatarEmoji: '',
          dailyGoalMinutes: 120,
          createdAt: now,
        };
      }

      // Generate 30-day session JWT
      const token = await signJwt(
        {
          sub: userRecord.id,
          email: userRecord.email,
          exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        },
        authSecret
      );

      return new Response(JSON.stringify({ token, user: userRecord }), { headers: corsHeaders });
    }

    // Helper to authenticate request
    const authHeader = request.headers.get('Authorization') || '';
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = tokenMatch ? tokenMatch[1] : null;
    const sessionPayload = token ? await verifyJwt(token, authSecret) : null;
    const currentUserId = sessionPayload?.sub as string | undefined;

    // GET /api/auth/me
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      if (!currentUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }

      const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
        .bind(currentUserId)
        .first<{
          id: string;
          email: string;
          display_name: string;
          avatar_url: string;
          avatar_emoji: string;
          daily_goal_minutes: number;
          created_at: string;
        }>();

      if (!user) {
        return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: corsHeaders });
      }

      return new Response(
        JSON.stringify({
          user: {
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            avatarUrl: user.avatar_url,
            avatarEmoji: user.avatar_emoji,
            dailyGoalMinutes: user.daily_goal_minutes,
            createdAt: user.created_at,
          },
        }),
        { headers: corsHeaders }
      );
    }

    // POST /api/tags — Direct upsert of a single tag (create / edit / archive / unarchive)
    if (url.pathname === '/api/tags' && request.method === 'POST') {
      if (!currentUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }

      const body = (await request.json().catch(() => ({}))) as {
        tag?: {
          id: string;
          name: string;
          color: string;
          isArchived?: boolean;
          createdAt?: string;
          updatedAt?: string;
        };
      };

      if (!body.tag || !body.tag.id || !body.tag.name) {
        return new Response(JSON.stringify({ error: 'Invalid tag payload' }), { status: 400, headers: corsHeaders });
      }

      const nowIso = new Date().toISOString();
      const updatedAtIso = body.tag.updatedAt || nowIso;

      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO tags (id, user_id, name, color, is_archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, id) DO UPDATE SET
             name = excluded.name,
             color = excluded.color,
             is_archived = excluded.is_archived,
             updated_at = excluded.updated_at`
        ).bind(
          body.tag.id,
          currentUserId,
          body.tag.name,
          body.tag.color,
          body.tag.isArchived ? 1 : 0,
          body.tag.createdAt || nowIso,
          updatedAtIso
        ),
        env.DB.prepare('DELETE FROM deleted_tags WHERE user_id = ? AND tag_id = ?').bind(currentUserId, body.tag.id),
      ]);

      const tagRows = await env.DB.prepare('SELECT * FROM tags WHERE user_id = ?')
        .bind(currentUserId)
        .all<{
          id: string;
          name: string;
          color: string;
          is_archived: number;
          created_at: string;
          updated_at: string;
        }>();

      const tags = (tagRows.results || []).map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        isArchived: Boolean(t.is_archived),
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }));

      return new Response(JSON.stringify({ success: true, tags, serverTime: Date.now() }), { headers: corsHeaders });
    }

    // DELETE /api/tags/:id — Hard delete a tag and unassign related sessions
    if (url.pathname.startsWith('/api/tags/') && request.method === 'DELETE') {
      if (!currentUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }

      const tagId = decodeURIComponent(url.pathname.replace('/api/tags/', ''));
      if (!tagId) {
        return new Response(JSON.stringify({ error: 'Missing tag ID' }), { status: 400, headers: corsHeaders });
      }

      await env.DB.batch([
        env.DB.prepare('UPDATE sessions SET tag_id = NULL WHERE user_id = ? AND tag_id = ?').bind(currentUserId, tagId),
        env.DB.prepare('UPDATE coffee_cups SET tag_id = NULL WHERE user_id = ? AND tag_id = ?').bind(currentUserId, tagId),
        env.DB.prepare('DELETE FROM tags WHERE user_id = ? AND id = ?').bind(currentUserId, tagId),
        env.DB.prepare('INSERT OR REPLACE INTO deleted_tags (user_id, tag_id) VALUES (?, ?)').bind(currentUserId, tagId),
      ]);

      return new Response(JSON.stringify({ success: true, deletedTagId: tagId }), { headers: corsHeaders });
    }

    // POST /api/sessions — Direct fast upsert of a completed focus session
    if (url.pathname === '/api/sessions' && request.method === 'POST') {
      if (!currentUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }

      const body = (await request.json().catch(() => ({}))) as {
        session?: {
          id: string;
          tagId?: string | null;
          sessionType: string;
          durationSeconds: number;
          completedAt: string;
        };
      };

      if (!body.session || !body.session.id || !body.session.completedAt) {
        return new Response(JSON.stringify({ error: 'Invalid session payload' }), { status: 400, headers: corsHeaders });
      }

      if (body.session.id.startsWith('sample-') || body.session.id.startsWith('seed-')) {
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      await env.DB.prepare(
        `INSERT INTO sessions (id, user_id, tag_id, session_type, duration_seconds, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           tag_id = excluded.tag_id,
           session_type = excluded.session_type,
           duration_seconds = excluded.duration_seconds,
           completed_at = excluded.completed_at`
      ).bind(
        body.session.id,
        currentUserId,
        body.session.tagId ?? null,
        body.session.sessionType,
        body.session.durationSeconds,
        body.session.completedAt
      ).run();

      return new Response(JSON.stringify({ success: true, serverTime: Date.now() }), { headers: corsHeaders });
    }

    // GET /api/timer — Fetch current active timer state, coffee cups, tags, presence, and session liveness
    if (url.pathname === "/api/timer" && request.method === "GET") {
      if (!currentUserId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }

      const isRunningHeartbeat = request.headers.get("X-Timer-Heartbeat") === "1";
      const now = Date.now();

      const [timerRow, coffeeRows, deletedCoffeeRows, tagRows, deletedTagRows, peerPresence, lastSessionRow] = await Promise.all([
        env.DB.prepare(
          "SELECT * FROM active_timers WHERE user_id = ?"
        ).bind(currentUserId).first<{
          session_type: string;
          status: string;
          remaining_seconds: number;
          total_seconds: number;
          target_end_time: number | null;
          current_cycle: number;
          tag_id: string | null;
          timer_run_id: string | null;
          updated_at_ms: number;
          last_heartbeat_ms: number | null;
        }>(),
        env.DB.prepare(
          "SELECT id, tag_id, date, created_at FROM coffee_cups WHERE user_id = ? ORDER BY created_at ASC"
        ).bind(currentUserId).all<{
          id: string;
          tag_id: string | null;
          date: string;
          created_at: string;
        }>(),
        env.DB.prepare(
          "SELECT cup_id FROM deleted_coffee_cups WHERE user_id = ?"
        ).bind(currentUserId).all<{ cup_id: string }>(),
        env.DB.prepare(
          "SELECT * FROM tags WHERE user_id = ?"
        ).bind(currentUserId).all<{
          id: string;
          name: string;
          color: string;
          is_archived: number;
          created_at: string;
          updated_at: string;
        }>(),
        env.DB.prepare(
          "SELECT tag_id FROM deleted_tags WHERE user_id = ?"
        ).bind(currentUserId).all<{ tag_id: string }>(),
        updateAndGetPeerPresence(env.DB, currentUserId, request, now),
        env.DB.prepare(
          "SELECT max(completed_at) as last_completed_at FROM sessions WHERE user_id = ? AND id NOT LIKE 'sample-%' AND id NOT LIKE 'seed-%'"
        ).bind(currentUserId).first<{ last_completed_at: string | null }>(),
      ]);

      let timer = null;

      if (timerRow) {
        const status = timerRow.status;
        let remainingSeconds = timerRow.remaining_seconds;
        const targetEndTime = timerRow.target_end_time;
        const updatedAtMs = timerRow.updated_at_ms;

        if (status === "RUNNING") {
          if (targetEndTime !== null) {
            remainingSeconds = Math.max(0, Math.ceil((targetEndTime - now) / 1000));
          }
          if (isRunningHeartbeat) {
            await env.DB.prepare(
              "UPDATE active_timers SET last_heartbeat_ms = ? WHERE user_id = ?"
            ).bind(now, currentUserId).run();
          }
        }

        timer = {
          sessionType: timerRow.session_type,
          status,
          remainingSeconds,
          totalSeconds: timerRow.total_seconds,
          targetEndTime,
          currentCycle: timerRow.current_cycle,
          activeTagId: timerRow.tag_id,
          timerRunId: timerRow.timer_run_id,
          updatedAtMs,
        };
      }

      const coffeeCups = (coffeeRows.results || []).map((c) => ({
        id: c.id,
        tagId: c.tag_id,
        date: c.date,
        createdAt: c.created_at,
      }));

      const deletedCoffeeCupIds = (deletedCoffeeRows.results || []).map((r) => r.cup_id);

      const tags = (tagRows.results || []).map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        isArchived: Boolean(t.is_archived),
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }));

      const deletedTagIds = (deletedTagRows.results || []).map((r) => r.tag_id);

      return new Response(
        JSON.stringify({
          timer,
          coffeeCups,
          deletedCoffeeCupIds,
          tags,
          deletedTagIds,
          peerPresence,
          serverTime: now,
          lastSessionCompletedAt: lastSessionRow?.last_completed_at ?? null,
        }),
        { headers: corsHeaders }
      );
    }

    // POST /api/timer — Update active timer state
    if (url.pathname === "/api/timer" && request.method === "POST") {
      if (!currentUserId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }

      const serverNow = Date.now();
      const body = (await request.json().catch(() => ({}))) as {
        sessionType?: string;
        status?: string;
        remainingSeconds?: number;
        totalSeconds?: number;
        targetEndTime?: number | null;
        currentCycle?: number;
        activeTagId?: string | null;
        timerRunId?: string | null;
        updatedAtMs?: number;
      };

      if (!body.sessionType || !body.status) {
        return new Response(JSON.stringify({ error: "Invalid timer payload" }), { status: 400, headers: corsHeaders });
      }

      const updatedAtMs = typeof body.updatedAtMs === "number" ? body.updatedAtMs : serverNow;

      const [, peerPresence] = await Promise.all([
        env.DB.prepare(
          `INSERT INTO active_timers (
             user_id, session_type, status, remaining_seconds, total_seconds,
             target_end_time, current_cycle, tag_id, timer_run_id, updated_at_ms, last_heartbeat_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             session_type = excluded.session_type,
             status = excluded.status,
             remaining_seconds = excluded.remaining_seconds,
             total_seconds = excluded.total_seconds,
             target_end_time = excluded.target_end_time,
             current_cycle = excluded.current_cycle,
             tag_id = excluded.tag_id,
             timer_run_id = excluded.timer_run_id,
             updated_at_ms = excluded.updated_at_ms,
             last_heartbeat_ms = excluded.last_heartbeat_ms
           WHERE excluded.updated_at_ms >= active_timers.updated_at_ms`
        )
          .bind(
            currentUserId,
            body.sessionType,
            body.status,
            body.remainingSeconds ?? 1500,
            body.totalSeconds ?? 1500,
            body.targetEndTime ?? null,
            body.currentCycle ?? 1,
            body.activeTagId ?? null,
            body.timerRunId ?? null,
            updatedAtMs,
            serverNow
          )
          .run(),
        updateAndGetPeerPresence(env.DB, currentUserId, request, serverNow),
      ]);

      return new Response(
        JSON.stringify({ success: true, updatedAtMs, peerPresence, serverTime: serverNow }),
        { headers: corsHeaders }
      );
    }

    // POST /api/coffee — Add or remove a coffee cup directly with instant D1 sync
    if (url.pathname === "/api/coffee" && request.method === "POST") {
      if (!currentUserId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }

      const body = (await request.json().catch(() => ({}))) as {
        action?: 'ADD' | 'REMOVE';
        cup?: { id: string; tagId: string | null; date: string; createdAt?: string };
        cupId?: string;
      };

      if (body.action === 'ADD' && body.cup) {
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO coffee_cups (id, user_id, tag_id, date, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               tag_id = excluded.tag_id,
               date = excluded.date`
          ).bind(
            body.cup.id,
            currentUserId,
            body.cup.tagId ?? null,
            body.cup.date,
            body.cup.createdAt || new Date().toISOString()
          ),
          env.DB.prepare('DELETE FROM deleted_coffee_cups WHERE user_id = ? AND cup_id = ?').bind(currentUserId, body.cup.id),
        ]);
      } else if (body.action === 'REMOVE' && body.cupId) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM coffee_cups WHERE user_id = ? AND id = ?').bind(currentUserId, body.cupId),
          env.DB.prepare('INSERT OR REPLACE INTO deleted_coffee_cups (user_id, cup_id) VALUES (?, ?)').bind(currentUserId, body.cupId),
        ]);
      }

      const coffeeRows = await env.DB.prepare(
        "SELECT id, tag_id, date, created_at FROM coffee_cups WHERE user_id = ? ORDER BY created_at ASC"
      ).bind(currentUserId).all<{ id: string; tag_id: string | null; date: string; created_at: string }>();

      const coffeeCups = (coffeeRows.results || []).map((c) => ({
        id: c.id,
        tagId: c.tag_id,
        date: c.date,
        createdAt: c.created_at,
      }));

      return new Response(JSON.stringify({ success: true, coffeeCups, serverTime: Date.now() }), { headers: corsHeaders });
    }

    // GET /api/sync — Fetch all cloud user data
    if (url.pathname === '/api/sync' && request.method === 'GET') {
      if (!currentUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }

      const [userRow, tagRows, sessionRows, settingsRow, deletedTagRows, coffeeRows, deletedCoffeeRows] = await Promise.all([
        env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(currentUserId).first<{
          id: string;
          email: string;
          display_name: string;
          avatar_url: string;
          avatar_emoji: string;
          daily_goal_minutes: number;
          created_at: string;
        }>(),
        env.DB.prepare('SELECT * FROM tags WHERE user_id = ?').bind(currentUserId).all<{
          id: string;
          name: string;
          color: string;
          is_archived: number;
          created_at: string;
          updated_at: string;
        }>(),
        env.DB.prepare("SELECT * FROM sessions WHERE user_id = ? AND id NOT LIKE 'sample-session-%' AND id NOT LIKE 'seed-session-%' ORDER BY completed_at DESC").bind(currentUserId).all<{
          id: string;
          tag_id: string | null;
          session_type: string;
          duration_seconds: number;
          completed_at: string;
        }>(),
        env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(currentUserId).first<{
          work_duration_minutes: number;
          short_break_duration_minutes: number;
          long_break_duration_minutes: number;
          long_break_interval: number;
          auto_start_breaks: number;
          auto_start_pomodoros: number;
          sound_enabled: number;
          sound_volume: number;
          notifications_enabled: number;
          keep_awake: number;
          updated_at: string;
        }>(),
        env.DB.prepare('SELECT tag_id FROM deleted_tags WHERE user_id = ?').bind(currentUserId).all<{
          tag_id: string;
        }>(),
        env.DB.prepare("SELECT id, tag_id, date, created_at FROM coffee_cups WHERE user_id = ? ORDER BY created_at ASC").bind(currentUserId).all<{
          id: string;
          tag_id: string | null;
          date: string;
          created_at: string;
        }>(),
        env.DB.prepare("SELECT cup_id FROM deleted_coffee_cups WHERE user_id = ?").bind(currentUserId).all<{
          cup_id: string;
        }>(),
      ]);

      const profile = userRow
        ? {
            id: userRow.id,
            email: userRow.email,
            displayName: userRow.display_name,
            avatarUrl: userRow.avatar_url,
            avatarEmoji: userRow.avatar_emoji,
            dailyGoalMinutes: userRow.daily_goal_minutes,
            createdAt: userRow.created_at,
          }
        : null;

      const tags = (tagRows.results || []).map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        isArchived: Boolean(t.is_archived),
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }));

      const sessions = (sessionRows.results || []).map((s) => ({
        id: s.id,
        tagId: s.tag_id,
        sessionType: s.session_type,
        durationSeconds: s.duration_seconds,
        completedAt: s.completed_at,
      }));

      const settings = settingsRow
        ? {
            workDurationMinutes: settingsRow.work_duration_minutes,
            shortBreakDurationMinutes: settingsRow.short_break_duration_minutes,
            longBreakDurationMinutes: settingsRow.long_break_duration_minutes,
            longBreakInterval: settingsRow.long_break_interval,
            autoStartBreaks: Boolean(settingsRow.auto_start_breaks),
            autoStartPomodoros: Boolean(settingsRow.auto_start_pomodoros),
            soundEnabled: Boolean(settingsRow.sound_enabled),
            soundVolume: settingsRow.sound_volume,
            notificationsEnabled: Boolean(settingsRow.notifications_enabled),
            keepAwake: Boolean(settingsRow.keep_awake),
            updatedAt: settingsRow.updated_at,
          }
        : null;

      const deletedTagIds = (deletedTagRows.results || []).map((r) => r.tag_id);
      const deletedCoffeeCupIds = (deletedCoffeeRows.results || []).map((r) => r.cup_id);
      const coffeeCups = (coffeeRows.results || []).map((c) => ({
        id: c.id,
        tagId: c.tag_id,
        date: c.date,
        createdAt: c.created_at,
      }));

      return new Response(
        JSON.stringify({
          profile,
          tags,
          sessions,
          settings,
          deletedTagIds,
          deletedCoffeeCupIds,
          coffeeCups,
          syncedAt: new Date().toISOString(),
          serverTime: Date.now(),
        }),
        { headers: corsHeaders }
      );
    }

    // POST /api/sync — Push and merge client data into cloud
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      if (!currentUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }

      const body = (await request.json().catch(() => ({}))) as {
        mode?: 'merge' | 'replace';
        clearSessions?: boolean;
        profile?: {
          displayName?: string;
          avatarEmoji?: string;
          dailyGoalMinutes?: number;
        };
        tags?: Array<{
          id: string;
          name: string;
          color: string;
          isArchived?: boolean;
          createdAt?: string;
          updatedAt?: string;
        }>;
        deletedTagIds?: string[];
        deletedCoffeeCupIds?: string[];
        sessions?: Array<{
          id: string;
          tagId: string | null;
          sessionType: string;
          durationSeconds: number;
          completedAt: string;
        }>;
        coffeeCups?: Array<{
          id: string;
          tagId: string | null;
          date: string;
          createdAt?: string;
        }>;
        settings?: {
          workDurationMinutes?: number;
          shortBreakDurationMinutes?: number;
          longBreakDurationMinutes?: number;
          longBreakInterval?: number;
          autoStartBreaks?: boolean;
          autoStartPomodoros?: boolean;
          soundEnabled?: boolean;
          soundVolume?: number;
          notificationsEnabled?: boolean;
          keepAwake?: boolean;
        };
      };

      // 0. Handle Replace or Clear Sessions mode
      if (body.mode === 'replace') {
        // Full override: delete existing sessions, tags, coffee cups, and deleted records for this user
        await env.DB.batch([
          env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(currentUserId),
          env.DB.prepare('DELETE FROM tags WHERE user_id = ?').bind(currentUserId),
          env.DB.prepare('DELETE FROM deleted_tags WHERE user_id = ?').bind(currentUserId),
          env.DB.prepare('DELETE FROM active_timers WHERE user_id = ?').bind(currentUserId),
          env.DB.prepare('DELETE FROM coffee_cups WHERE user_id = ?').bind(currentUserId),
          env.DB.prepare('DELETE FROM deleted_coffee_cups WHERE user_id = ?').bind(currentUserId),
        ]);
      } else if (body.clearSessions || (body as any).clearHistory) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(currentUserId),
          env.DB.prepare('DELETE FROM coffee_cups WHERE user_id = ?').bind(currentUserId),
          env.DB.prepare('DELETE FROM deleted_coffee_cups WHERE user_id = ?').bind(currentUserId),
        ]);
      }

      const statements: D1PreparedStatement[] = [];

      // 1. Process Deleted Tags (if not replacing)
      if (body.mode !== 'replace' && Array.isArray(body.deletedTagIds) && body.deletedTagIds.length > 0) {
        for (const tagId of body.deletedTagIds) {
          statements.push(
            env.DB.prepare('UPDATE sessions SET tag_id = NULL WHERE user_id = ? AND tag_id = ?').bind(currentUserId, tagId),
            env.DB.prepare('DELETE FROM tags WHERE user_id = ? AND id = ?').bind(currentUserId, tagId),
            env.DB.prepare('INSERT OR REPLACE INTO deleted_tags (user_id, tag_id) VALUES (?, ?)').bind(currentUserId, tagId)
          );
        }
      }

      // 1.5 Process Deleted Coffee Cups (if not replacing)
      if (body.mode !== 'replace' && Array.isArray(body.deletedCoffeeCupIds) && body.deletedCoffeeCupIds.length > 0) {
        for (const cupId of body.deletedCoffeeCupIds) {
          statements.push(
            env.DB.prepare('DELETE FROM coffee_cups WHERE user_id = ? AND id = ?').bind(currentUserId, cupId),
            env.DB.prepare('INSERT OR REPLACE INTO deleted_coffee_cups (user_id, cup_id) VALUES (?, ?)').bind(currentUserId, cupId)
          );
        }
      }

      // 2. Update Profile if provided
      if (body.profile) {
        const { displayName, avatarEmoji, dailyGoalMinutes } = body.profile;
        statements.push(
          env.DB.prepare(
            `UPDATE users SET 
              display_name = COALESCE(?, display_name),
              avatar_emoji = COALESCE(?, avatar_emoji),
              daily_goal_minutes = COALESCE(?, daily_goal_minutes),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`
          ).bind(
            displayName ?? null,
            avatarEmoji ?? null,
            dailyGoalMinutes ?? null,
            currentUserId
          )
        );
      }

      // 3. Upsert Tags (excluding any that were deleted), preserving newer cloud state via updated_at comparison
      const deletedSet = body.mode === 'replace' ? new Set<string>() : new Set(body.deletedTagIds || []);
      if (Array.isArray(body.tags) && body.tags.length > 0) {
        for (const tag of body.tags) {
          if (deletedSet.has(tag.id)) continue;
          const createdAtIso = tag.createdAt || '1970-01-01T00:00:00.000Z';
          const updatedAtIso = tag.updatedAt || createdAtIso;
          statements.push(
            env.DB.prepare(
              `INSERT INTO tags (id, user_id, name, color, is_archived, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, id) DO UPDATE SET
                 name = excluded.name,
                 color = excluded.color,
                 is_archived = excluded.is_archived,
                 updated_at = excluded.updated_at
               WHERE tags.user_id = excluded.user_id
                 AND (tags.updated_at IS NULL OR tags.updated_at = '' OR datetime(excluded.updated_at) >= datetime(tags.updated_at))`
            ).bind(
              tag.id,
              currentUserId,
              tag.name,
              tag.color,
              tag.isArchived ? 1 : 0,
              createdAtIso,
              updatedAtIso
            )
          );
        }
      }

      // 4. Upsert Sessions
      if (Array.isArray(body.sessions) && body.sessions.length > 0) {
        for (const session of body.sessions) {
          if (session.id.startsWith('sample-session-') || session.id.startsWith('seed-session-')) continue;
          const effectiveTagId = session.tagId && deletedSet.has(session.tagId) ? null : session.tagId;
          statements.push(
            env.DB.prepare(
              `INSERT INTO sessions (id, user_id, tag_id, session_type, duration_seconds, completed_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 tag_id = excluded.tag_id,
                 session_type = excluded.session_type,
                 duration_seconds = excluded.duration_seconds,
                 completed_at = excluded.completed_at`
            ).bind(
              session.id,
              currentUserId,
              effectiveTagId,
              session.sessionType,
              session.durationSeconds,
              session.completedAt
            )
          );
        }
      }

      // 4.5 Upsert Coffee Cups
      const deletedCoffeeSet = body.mode === 'replace' ? new Set<string>() : new Set(body.deletedCoffeeCupIds || []);
      if (Array.isArray(body.coffeeCups) && body.coffeeCups.length > 0) {
        for (const cup of body.coffeeCups) {
          if (deletedCoffeeSet.has(cup.id)) continue;
          const effectiveTagId = cup.tagId && deletedSet.has(cup.tagId) ? null : cup.tagId;
          statements.push(
            env.DB.prepare(
              `INSERT INTO coffee_cups (id, user_id, tag_id, date, created_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 tag_id = excluded.tag_id,
                 date = excluded.date`
            ).bind(
              cup.id,
              currentUserId,
              effectiveTagId,
              cup.date,
              cup.createdAt || new Date().toISOString()
            )
          );
        }
      }

      // 5. Upsert Settings
      if (body.settings) {
        const s = body.settings;
        statements.push(
          env.DB.prepare(
            `INSERT INTO user_settings (
               user_id, work_duration_minutes, short_break_duration_minutes, long_break_duration_minutes,
               long_break_interval, auto_start_breaks, auto_start_pomodoros, sound_enabled, sound_volume,
               notifications_enabled, keep_awake, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id) DO UPDATE SET
               work_duration_minutes = COALESCE(excluded.work_duration_minutes, user_settings.work_duration_minutes),
               short_break_duration_minutes = COALESCE(excluded.short_break_duration_minutes, user_settings.short_break_duration_minutes),
               long_break_duration_minutes = COALESCE(excluded.long_break_duration_minutes, user_settings.long_break_duration_minutes),
               long_break_interval = COALESCE(excluded.long_break_interval, user_settings.long_break_interval),
               auto_start_breaks = COALESCE(excluded.auto_start_breaks, user_settings.auto_start_breaks),
               auto_start_pomodoros = COALESCE(excluded.auto_start_pomodoros, user_settings.auto_start_pomodoros),
               sound_enabled = COALESCE(excluded.sound_enabled, user_settings.sound_enabled),
               sound_volume = COALESCE(excluded.sound_volume, user_settings.sound_volume),
               notifications_enabled = COALESCE(excluded.notifications_enabled, user_settings.notifications_enabled),
               keep_awake = COALESCE(excluded.keep_awake, user_settings.keep_awake),
               updated_at = CURRENT_TIMESTAMP`
          ).bind(
            currentUserId,
            s.workDurationMinutes ?? 25,
            s.shortBreakDurationMinutes ?? 5,
            s.longBreakDurationMinutes ?? 25,
            s.longBreakInterval ?? 4,
            s.autoStartBreaks ? 1 : 0,
            s.autoStartPomodoros ? 1 : 0,
            s.soundEnabled !== false ? 1 : 0,
            s.soundVolume ?? 0.8,
            s.notificationsEnabled ? 1 : 0,
            s.keepAwake ? 1 : 0
          )
        );
      }

      // Execute in chunks to respect Cloudflare D1 batch limits
      const BATCH_SIZE = 50;
      for (let i = 0; i < statements.length; i += BATCH_SIZE) {
        const chunk = statements.slice(i, i + BATCH_SIZE);
        await env.DB.batch(chunk);
      }

      return new Response(
        JSON.stringify({
          success: true,
          syncedAt: new Date().toISOString(),
          serverTime: Date.now(),
          processedRecords: {
            tags: body.tags?.length || 0,
            sessions: body.sessions?.length || 0,
            coffeeCups: body.coffeeCups?.length || 0,
            deletedTags: body.deletedTagIds?.length || 0,
            deletedCoffeeCupIds: body.deletedCoffeeCupIds?.length || 0,
            mode: body.mode || 'merge',
          },
        }),
        { headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
      status: 404,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error('API Error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || 'Internal Server Error' }),
      { status: 500, headers: corsHeaders }
    );
  }
}
