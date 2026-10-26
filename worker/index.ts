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

const DESKTOP_PRESENCE_TTL_MS = 25000;
const MOBILE_PRESENCE_TTL_MS = 35000;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    google_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    avatar_emoji TEXT DEFAULT '',
    daily_goal_minutes INTEGER DEFAULT 120,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    is_archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS deleted_tags (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL,
    deleted_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, tag_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag_id TEXT,
    session_type TEXT NOT NULL CHECK(session_type IN ('WORK', 'SHORT_BREAK', 'LONG_BREAK')),
    duration_seconds INTEGER NOT NULL,
    completed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, completed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user_tag ON sessions(user_id, tag_id)`,
  `CREATE TABLE IF NOT EXISTS coffee_cups (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag_id TEXT,
    date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_coffee_cups_user_created ON coffee_cups(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_coffee_cups_user_date ON coffee_cups(user_id, date)`,
  `CREATE INDEX IF NOT EXISTS idx_coffee_cups_user_tag ON coffee_cups(user_id, tag_id)`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    work_duration_minutes REAL DEFAULT 25,
    short_break_duration_minutes REAL DEFAULT 5,
    long_break_duration_minutes REAL DEFAULT 25,
    long_break_interval INTEGER DEFAULT 4,
    auto_start_breaks INTEGER DEFAULT 0,
    auto_start_pomodoros INTEGER DEFAULT 0,
    sound_enabled INTEGER DEFAULT 1,
    sound_volume REAL DEFAULT 0.8,
    notifications_enabled INTEGER DEFAULT 0,
    keep_awake INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS active_timers (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    session_type TEXT NOT NULL,
    status TEXT NOT NULL,
    remaining_seconds INTEGER NOT NULL,
    total_seconds INTEGER NOT NULL,
    target_end_time INTEGER,
    current_cycle INTEGER NOT NULL,
    tag_id TEXT,
    timer_run_id TEXT,
    updated_at_ms INTEGER NOT NULL,
    last_heartbeat_ms INTEGER,
    tags_version INTEGER DEFAULT 1,
    coffee_version INTEGER DEFAULT 1,
    last_session_completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS deleted_coffee_cups (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cup_id TEXT NOT NULL,
    deleted_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, cup_id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_device_presence (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_type TEXT NOT NULL,
    is_visible INTEGER DEFAULT 0,
    last_seen_ms INTEGER NOT NULL,
    PRIMARY KEY (user_id, device_id)
  )`,
];

let isSchemaEnsured = false;

async function ensureSchema(db: D1Database): Promise<void> {
  if (isSchemaEnsured) return;

  try {
    // Fast path: verify schema is already up to date without issuing DDL
    await db.prepare('SELECT last_heartbeat_ms, tags_version, coffee_version, last_session_completed_at FROM active_timers LIMIT 1').first();
    await db.prepare('SELECT keep_awake FROM user_settings LIMIT 1').first();
    isSchemaEnsured = true;
    return;
  } catch {
    // Fall through to run table creation and dynamic column migrations
  }

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
          SELECT id, user_id, name, color, COALESCE(is_archived, 0), COALESCE(created_at, CURRENT_TIMESTAMP), COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) FROM tags`),
        db.prepare('DROP TABLE tags'),
        db.prepare('ALTER TABLE tags_new RENAME TO tags'),
        db.prepare('PRAGMA defer_foreign_keys = OFF'),
      ]);
    }
  } catch (migErr) {
    console.warn('Tags PK migration check:', migErr);
  }

  try {
    await db.prepare('ALTER TABLE active_timers ADD COLUMN last_heartbeat_ms INTEGER').run();
  } catch {}
  try {
    await db.prepare('ALTER TABLE active_timers ADD COLUMN tags_version INTEGER DEFAULT 1').run();
  } catch {}
  try {
    await db.prepare('ALTER TABLE active_timers ADD COLUMN coffee_version INTEGER DEFAULT 1').run();
  } catch {}
  try {
    await db.prepare('ALTER TABLE active_timers ADD COLUMN last_session_completed_at TEXT').run();
  } catch {}
  try {
    await db.prepare('ALTER TABLE user_settings ADD COLUMN keep_awake INTEGER DEFAULT 0').run();
  } catch {}

  // Backfill existing rows with safe defaults for transitioning users
  try {
    await db.prepare('UPDATE active_timers SET tags_version = 1 WHERE tags_version IS NULL').run();
  } catch {}
  try {
    await db.prepare('UPDATE active_timers SET coffee_version = 1 WHERE coffee_version IS NULL').run();
  } catch {}
  try {
    await db.prepare("UPDATE active_timers SET last_session_completed_at = '' WHERE last_session_completed_at IS NULL").run();
  } catch {}
  try {
    await db.prepare('UPDATE tags SET is_archived = 0 WHERE is_archived IS NULL').run();
  } catch {}
  try {
    await db.prepare("UPDATE tags SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL OR updated_at = ''").run();
  } catch {}

  // Clean up duplicate/redundant indexes and ensure performance indexes
  try {
    await db.batch([
      db.prepare('DROP INDEX IF EXISTS uq_tags_user_id'),
      db.prepare('DROP INDEX IF EXISTS idx_tags_user'),
      db.prepare('DROP INDEX IF EXISTS idx_deleted_tags_user'),
      db.prepare('DROP INDEX IF EXISTS idx_deleted_coffee_cups_user'),
      db.prepare('DROP INDEX IF EXISTS uq_device_presence'),
      db.prepare('DROP INDEX IF EXISTS idx_device_presence_user'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_user_tag ON sessions(user_id, tag_id)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_coffee_cups_user_created ON coffee_cups(user_id, created_at)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_coffee_cups_user_tag ON coffee_cups(user_id, tag_id)'),
    ]);
  } catch {}

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
  const shouldTouch = request.headers.get('X-Device-Touch') !== '0';

  try {
    const statements: D1PreparedStatement[] = [];

    if (deviceId) {
      if (isClosed) {
        statements.push(
          db.prepare('DELETE FROM user_device_presence WHERE user_id = ? AND device_id = ?').bind(userId, deviceId)
        );
      } else if (shouldTouch) {
        statements.push(
          db
            .prepare(
              `INSERT INTO user_device_presence (user_id, device_id, device_type, is_visible, last_seen_ms)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id, device_id) DO UPDATE SET
                 device_type = excluded.device_type,
                 is_visible = excluded.is_visible,
                 last_seen_ms = excluded.last_seen_ms
               WHERE excluded.is_visible != user_device_presence.is_visible
                  OR (excluded.last_seen_ms - user_device_presence.last_seen_ms) >= 15000`
            )
            .bind(userId, deviceId, deviceType, isVisible, now)
        );

        // Prune presence records older than 1 hour occasionally (5% probability) to minimize D1 write volume
        if (Math.random() < 0.05) {
          statements.push(
            db
              .prepare('DELETE FROM user_device_presence WHERE user_id = ? AND last_seen_ms < ?')
              .bind(userId, now - 3600000)
          );
        }
      }
    }

    statements.push(
      db
        .prepare('SELECT device_id, device_type, is_visible, last_seen_ms FROM user_device_presence WHERE user_id = ?')
        .bind(userId)
    );

    const batchResults = await db.batch<{ device_id: string; device_type: string; is_visible: number; last_seen_ms: number }>(statements);
    const rows = batchResults[batchResults.length - 1];

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
      'Content-Type, Authorization, X-Timer-Heartbeat, X-Device-Id, X-Device-Type, X-Device-Visible, X-Device-Closed, X-Device-Touch, X-Tags-Version, X-Coffee-Version',
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
          await env.DB.prepare('SELECT 1 FROM active_timers LIMIT 1').first();
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

      const batchResults = await env.DB.batch([
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
        env.DB.prepare('UPDATE active_timers SET tags_version = COALESCE(tags_version, 1) + 1 WHERE user_id = ?').bind(currentUserId),
        env.DB.prepare('SELECT * FROM tags WHERE user_id = ?').bind(currentUserId),
      ]);

      const tagRows = batchResults[3] as D1Result<{
        id: string;
        name: string;
        color: string;
        is_archived: number;
        created_at: string;
        updated_at: string;
      }>;

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
        env.DB.prepare('UPDATE active_timers SET tag_id = NULL WHERE user_id = ? AND tag_id = ?').bind(currentUserId, tagId),
        env.DB.prepare('DELETE FROM tags WHERE user_id = ? AND id = ?').bind(currentUserId, tagId),
        env.DB.prepare('INSERT OR REPLACE INTO deleted_tags (user_id, tag_id) VALUES (?, ?)').bind(currentUserId, tagId),
        env.DB.prepare('UPDATE active_timers SET tags_version = COALESCE(tags_version, 1) + 1 WHERE user_id = ?').bind(currentUserId),
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

      await env.DB.batch([
        env.DB.prepare(
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
        ),
        env.DB.prepare(
          'UPDATE active_timers SET last_session_completed_at = ? WHERE user_id = ?'
        ).bind(body.session.completedAt, currentUserId),
      ]);

      return new Response(JSON.stringify({ success: true, serverTime: Date.now() }), { headers: corsHeaders });
    }

    // GET /api/timer — Fetch current active timer state, coffee cups, tags, presence, and session liveness
    if (url.pathname === "/api/timer" && request.method === "GET") {
      if (!currentUserId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }

      const isRunningHeartbeat = request.headers.get("X-Timer-Heartbeat") === "1";
      const clientTagsVersion = parseInt(request.headers.get("X-Tags-Version") || "0", 10);
      const clientCoffeeVersion = parseInt(request.headers.get("X-Coffee-Version") || "0", 10);
      const now = Date.now();

      const [timerRow, peerPresence] = await Promise.all([
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
          tags_version: number | null;
          coffee_version: number | null;
          last_session_completed_at: string | null;
        }>(),
        updateAndGetPeerPresence(env.DB, currentUserId, request, now),
      ]);

      let timer = null;
      const tagsVersion = timerRow?.tags_version ?? 1;
      const coffeeVersion = timerRow?.coffee_version ?? 1;
      let lastSessionCompletedAt = timerRow?.last_session_completed_at ?? null;

      if (timerRow) {
        const status = timerRow.status;
        let remainingSeconds = timerRow.remaining_seconds;
        const targetEndTime = timerRow.target_end_time;
        const updatedAtMs = timerRow.updated_at_ms;

        let effectiveStatus = status;
        let effectiveTargetEndTime = targetEndTime;
        let effectiveRunId = timerRow.timer_run_id;

        if (status === "RUNNING") {
          if (targetEndTime !== null) {
            const overdueMs = now - targetEndTime;
            if (overdueMs > 900000) {
              // Timer was abandoned more than 15 minutes ago; auto-reset to IDLE
              effectiveStatus = "IDLE";
              effectiveTargetEndTime = null;
              effectiveRunId = null;
              remainingSeconds = timerRow.total_seconds;
              await env.DB.prepare(
                "UPDATE active_timers SET status = 'IDLE', remaining_seconds = total_seconds, target_end_time = NULL WHERE user_id = ?"
              ).bind(currentUserId).run();
            } else {
              remainingSeconds = Math.max(0, Math.ceil((targetEndTime - now) / 1000));
            }
          }
          // Throttle heartbeat writes: write at most once every 30 seconds to conserve D1 quota
          if (isRunningHeartbeat && effectiveStatus === "RUNNING" && (now - (timerRow.last_heartbeat_ms || 0) >= 30000)) {
            await env.DB.prepare(
              "UPDATE active_timers SET last_heartbeat_ms = ? WHERE user_id = ?"
            ).bind(now, currentUserId).run();
          }
        }

        timer = {
          sessionType: timerRow.session_type,
          status: effectiveStatus,
          remainingSeconds,
          totalSeconds: timerRow.total_seconds,
          targetEndTime: effectiveTargetEndTime,
          currentCycle: timerRow.current_cycle,
          activeTagId: timerRow.tag_id,
          timerRunId: effectiveRunId,
          updatedAtMs,
        };
      }

      // Check if client needs tags, coffee, or session backfill
      const needsTags = clientTagsVersion === 0 || clientTagsVersion !== tagsVersion;
      const needsCoffee = clientCoffeeVersion === 0 || clientCoffeeVersion !== coffeeVersion;
      const needsSessionBackfill = lastSessionCompletedAt === null;

      let coffeeCups: any[] | undefined = undefined;
      let deletedCoffeeCupIds: string[] | undefined = undefined;
      let tags: any[] | undefined = undefined;
      let deletedTagIds: string[] | undefined = undefined;

      if (needsTags || needsCoffee || needsSessionBackfill) {
        const statements: D1PreparedStatement[] = [];
        let tagsIdx = -1;
        let delTagsIdx = -1;
        let coffeeIdx = -1;
        let delCoffeeIdx = -1;
        let sessionIdx = -1;

        if (needsTags) {
          tagsIdx = statements.length;
          statements.push(env.DB.prepare("SELECT * FROM tags WHERE user_id = ?").bind(currentUserId));
          delTagsIdx = statements.length;
          statements.push(env.DB.prepare("SELECT tag_id FROM deleted_tags WHERE user_id = ?").bind(currentUserId));
        }

        if (needsCoffee) {
          coffeeIdx = statements.length;
          statements.push(env.DB.prepare("SELECT id, tag_id, date, created_at FROM coffee_cups WHERE user_id = ? ORDER BY created_at ASC").bind(currentUserId));
          delCoffeeIdx = statements.length;
          statements.push(env.DB.prepare("SELECT cup_id FROM deleted_coffee_cups WHERE user_id = ?").bind(currentUserId));
        }

        if (needsSessionBackfill) {
          sessionIdx = statements.length;
          statements.push(env.DB.prepare("SELECT completed_at as last_completed_at FROM sessions WHERE user_id = ? ORDER BY completed_at DESC LIMIT 1").bind(currentUserId));
        }

        const batchResults = await env.DB.batch(statements);

        if (tagsIdx >= 0) {
          const tagRows = batchResults[tagsIdx] as D1Result<{ id: string; name: string; color: string; is_archived: number; created_at: string; updated_at: string }>;
          tags = (tagRows.results || []).map((t) => ({
            id: t.id,
            name: t.name,
            color: t.color,
            isArchived: Boolean(t.is_archived),
            createdAt: t.created_at,
            updatedAt: t.updated_at,
          }));
          const delTagRows = batchResults[delTagsIdx] as D1Result<{ tag_id: string }>;
          deletedTagIds = (delTagRows.results || []).map((r) => r.tag_id);
        }

        if (coffeeIdx >= 0) {
          const coffeeRows = batchResults[coffeeIdx] as D1Result<{ id: string; tag_id: string | null; date: string; created_at: string }>;
          coffeeCups = (coffeeRows.results || []).map((c) => ({
            id: c.id,
            tagId: c.tag_id,
            date: c.date,
            createdAt: c.created_at,
          }));
          const delCoffeeRows = batchResults[delCoffeeIdx] as D1Result<{ cup_id: string }>;
          deletedCoffeeCupIds = (delCoffeeRows.results || []).map((r) => r.cup_id);
        }

        if (sessionIdx >= 0) {
          const sessionRow = batchResults[sessionIdx].results?.[0] as { last_completed_at: string | null } | undefined;
          const latestCompleted = sessionRow?.last_completed_at || "";
          lastSessionCompletedAt = latestCompleted || null;
          await env.DB.prepare("UPDATE active_timers SET last_session_completed_at = ? WHERE user_id = ?").bind(latestCompleted, currentUserId).run();
        }
      }

      return new Response(
        JSON.stringify({
          timer,
          coffeeCups,
          deletedCoffeeCupIds,
          tags,
          deletedTagIds,
          peerPresence,
          serverTime: now,
          lastSessionCompletedAt,
          tagsVersion,
          coffeeVersion,
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

      const statements: D1PreparedStatement[] = [];

      if (body.action === 'ADD' && body.cup) {
        statements.push(
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
          env.DB.prepare('DELETE FROM deleted_coffee_cups WHERE user_id = ? AND cup_id = ?').bind(currentUserId, body.cup.id)
        );
      } else if (body.action === 'REMOVE' && body.cupId) {
        statements.push(
          env.DB.prepare('DELETE FROM coffee_cups WHERE user_id = ? AND id = ?').bind(currentUserId, body.cupId),
          env.DB.prepare('INSERT OR REPLACE INTO deleted_coffee_cups (user_id, cup_id) VALUES (?, ?)').bind(currentUserId, body.cupId)
        );
      }

      statements.push(
        env.DB.prepare('UPDATE active_timers SET coffee_version = COALESCE(coffee_version, 1) + 1 WHERE user_id = ?').bind(currentUserId),
        env.DB.prepare(
          "SELECT id, tag_id, date, created_at FROM coffee_cups WHERE user_id = ? ORDER BY created_at ASC"
        ).bind(currentUserId)
      );

      const batchResults = await env.DB.batch(statements);
      const coffeeRows = batchResults[batchResults.length - 1] as D1Result<{ id: string; tag_id: string | null; date: string; created_at: string }>;

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

      const results = await env.DB.batch([
        env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(currentUserId),
        env.DB.prepare('SELECT * FROM tags WHERE user_id = ?').bind(currentUserId),
        env.DB.prepare("SELECT * FROM sessions WHERE user_id = ? AND id NOT LIKE 'sample-session-%' AND id NOT LIKE 'seed-session-%' ORDER BY completed_at DESC").bind(currentUserId),
        env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(currentUserId),
        env.DB.prepare('SELECT tag_id FROM deleted_tags WHERE user_id = ?').bind(currentUserId),
        env.DB.prepare("SELECT id, tag_id, date, created_at FROM coffee_cups WHERE user_id = ? ORDER BY created_at ASC").bind(currentUserId),
        env.DB.prepare("SELECT cup_id FROM deleted_coffee_cups WHERE user_id = ?").bind(currentUserId),
      ]);

      const userRow = (results[0].results?.[0] as any) || null;
      const tagRows = results[1] as D1Result<{
        id: string;
        name: string;
        color: string;
        is_archived: number;
        created_at: string;
        updated_at: string;
      }>;
      const sessionRows = results[2] as D1Result<{
        id: string;
        tag_id: string | null;
        session_type: string;
        duration_seconds: number;
        completed_at: string;
      }>;
      const settingsRow = (results[3].results?.[0] as any) || null;
      const deletedTagRows = results[4] as D1Result<{ tag_id: string }>;
      const coffeeRows = results[5] as D1Result<{
        id: string;
        tag_id: string | null;
        date: string;
        created_at: string;
      }>;
      const deletedCoffeeRows = results[6] as D1Result<{ cup_id: string }>;

      const profile = userRow
        ? {
            id: userRow.id,
            email: userRow.email,
            displayName: userRow.display_name || "",
            avatarUrl: userRow.avatar_url || "",
            avatarEmoji: userRow.avatar_emoji || "",
            dailyGoalMinutes: Number(userRow.daily_goal_minutes) || 120,
            createdAt: userRow.created_at || new Date().toISOString(),
          }
        : null;

      const tags = (tagRows.results || []).map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color || "#7E57C2",
        isArchived: Boolean(t.is_archived),
        createdAt: t.created_at || new Date().toISOString(),
        updatedAt: t.updated_at || t.created_at || new Date().toISOString(),
      }));

      const sessions = (sessionRows.results || []).map((s) => ({
        id: s.id,
        tagId: s.tag_id || null,
        sessionType: s.session_type,
        durationSeconds: Number(s.duration_seconds) || 1500,
        completedAt: s.completed_at,
      }));

      const settings = settingsRow
        ? {
            workDurationMinutes: Number(settingsRow.work_duration_minutes) || 25,
            shortBreakDurationMinutes: Number(settingsRow.short_break_duration_minutes) || 5,
            longBreakDurationMinutes: Number(settingsRow.long_break_duration_minutes) || 25,
            longBreakInterval: Number(settingsRow.long_break_interval) || 4,
            autoStartBreaks: Boolean(settingsRow.auto_start_breaks),
            autoStartPomodoros: Boolean(settingsRow.auto_start_pomodoros),
            soundEnabled: settingsRow.sound_enabled !== 0 && settingsRow.sound_enabled !== false,
            soundVolume: typeof settingsRow.sound_volume === "number" && !Number.isNaN(settingsRow.sound_volume) ? settingsRow.sound_volume : 0.8,
            notificationsEnabled: Boolean(settingsRow.notifications_enabled),
            updatedAt: settingsRow.updated_at || new Date().toISOString(),
          }
        : null;

      const deletedTagIds = (deletedTagRows.results || []).map((r) => r.tag_id);
      const deletedCoffeeCupIds = (deletedCoffeeRows.results || []).map((r) => r.cup_id);
      const coffeeCups = (coffeeRows.results || []).map((c) => ({
        id: c.id,
        tagId: c.tag_id || null,
        date: c.date ? c.date.slice(0, 10) : (c.created_at ? c.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)),
        createdAt: c.created_at || new Date().toISOString(),
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
          env.DB.prepare('UPDATE active_timers SET last_session_completed_at = NULL WHERE user_id = ?').bind(currentUserId),
        ]);
      }

      const statements: D1PreparedStatement[] = [];

      // 1. Process Deleted Tags (if not replacing) using set-based operations
      if (body.mode !== 'replace' && Array.isArray(body.deletedTagIds) && body.deletedTagIds.length > 0) {
        const placeholders = body.deletedTagIds.map(() => '?').join(',');
        statements.push(
          env.DB.prepare(`UPDATE sessions SET tag_id = NULL WHERE user_id = ? AND tag_id IN (${placeholders})`).bind(currentUserId, ...body.deletedTagIds),
          env.DB.prepare(`UPDATE coffee_cups SET tag_id = NULL WHERE user_id = ? AND tag_id IN (${placeholders})`).bind(currentUserId, ...body.deletedTagIds),
          env.DB.prepare(`UPDATE active_timers SET tag_id = NULL WHERE user_id = ? AND tag_id IN (${placeholders})`).bind(currentUserId, ...body.deletedTagIds),
          env.DB.prepare(`DELETE FROM tags WHERE user_id = ? AND id IN (${placeholders})`).bind(currentUserId, ...body.deletedTagIds)
        );
        for (const tagId of body.deletedTagIds) {
          statements.push(
            env.DB.prepare('INSERT OR REPLACE INTO deleted_tags (user_id, tag_id) VALUES (?, ?)').bind(currentUserId, tagId)
          );
        }
      }

      // 1.5 Process Deleted Coffee Cups (if not replacing) using set-based operations
      if (body.mode !== 'replace' && Array.isArray(body.deletedCoffeeCupIds) && body.deletedCoffeeCupIds.length > 0) {
        const placeholders = body.deletedCoffeeCupIds.map(() => '?').join(',');
        statements.push(
          env.DB.prepare(`DELETE FROM coffee_cups WHERE user_id = ? AND id IN (${placeholders})`).bind(currentUserId, ...body.deletedCoffeeCupIds)
        );
        for (const cupId of body.deletedCoffeeCupIds) {
          statements.push(
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
      const tagsToUndelete: string[] = [];

      if (Array.isArray(body.tags) && body.tags.length > 0) {
        for (const tag of body.tags) {
          if (deletedSet.has(tag.id)) continue;
          tagsToUndelete.push(tag.id);
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

      if (tagsToUndelete.length > 0) {
        const placeholders = tagsToUndelete.map(() => '?').join(',');
        statements.push(
          env.DB.prepare(`DELETE FROM deleted_tags WHERE user_id = ? AND tag_id IN (${placeholders})`).bind(currentUserId, ...tagsToUndelete)
        );
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
      const cupsToUndelete: string[] = [];

      if (Array.isArray(body.coffeeCups) && body.coffeeCups.length > 0) {
        for (const cup of body.coffeeCups) {
          if (deletedCoffeeSet.has(cup.id)) continue;
          cupsToUndelete.push(cup.id);
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

      if (cupsToUndelete.length > 0) {
        const placeholders = cupsToUndelete.map(() => '?').join(',');
        statements.push(
          env.DB.prepare(`DELETE FROM deleted_coffee_cups WHERE user_id = ? AND cup_id IN (${placeholders})`).bind(currentUserId, ...cupsToUndelete)
        );
      }

      // 5. Upsert Settings
      if (body.settings) {
        const s = body.settings;
        statements.push(
          env.DB.prepare(
            `INSERT INTO user_settings (
               user_id, work_duration_minutes, short_break_duration_minutes, long_break_duration_minutes,
               long_break_interval, auto_start_breaks, auto_start_pomodoros, sound_enabled, sound_volume,
               notifications_enabled, updated_at
             ) VALUES (
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
             )
             ON CONFLICT(user_id) DO UPDATE SET
               work_duration_minutes = COALESCE(excluded.work_duration_minutes, user_settings.work_duration_minutes, 25),
               short_break_duration_minutes = COALESCE(excluded.short_break_duration_minutes, user_settings.short_break_duration_minutes, 5),
               long_break_duration_minutes = COALESCE(excluded.long_break_duration_minutes, user_settings.long_break_duration_minutes, 25),
               long_break_interval = COALESCE(excluded.long_break_interval, user_settings.long_break_interval, 4),
               auto_start_breaks = COALESCE(excluded.auto_start_breaks, user_settings.auto_start_breaks, 0),
               auto_start_pomodoros = COALESCE(excluded.auto_start_pomodoros, user_settings.auto_start_pomodoros, 0),
               sound_enabled = COALESCE(excluded.sound_enabled, user_settings.sound_enabled, 1),
               sound_volume = COALESCE(excluded.sound_volume, user_settings.sound_volume, 0.8),
               notifications_enabled = COALESCE(excluded.notifications_enabled, user_settings.notifications_enabled, 0),
               updated_at = CURRENT_TIMESTAMP`
          ).bind(
            currentUserId,
            s.workDurationMinutes !== undefined ? s.workDurationMinutes : null,
            s.shortBreakDurationMinutes !== undefined ? s.shortBreakDurationMinutes : null,
            s.longBreakDurationMinutes !== undefined ? s.longBreakDurationMinutes : null,
            s.longBreakInterval !== undefined ? s.longBreakInterval : null,
            s.autoStartBreaks !== undefined ? (s.autoStartBreaks ? 1 : 0) : null,
            s.autoStartPomodoros !== undefined ? (s.autoStartPomodoros ? 1 : 0) : null,
            s.soundEnabled !== undefined ? (s.soundEnabled ? 1 : 0) : null,
            s.soundVolume !== undefined ? s.soundVolume : null,
            s.notificationsEnabled !== undefined ? (s.notificationsEnabled ? 1 : 0) : null
          )
        );
      }

      // Bump versions on active_timers for cross-device notification
      if (body.tags?.length || body.deletedTagIds?.length) {
        statements.push(
          env.DB.prepare('UPDATE active_timers SET tags_version = COALESCE(tags_version, 1) + 1 WHERE user_id = ?').bind(currentUserId)
        );
      }
      if (body.coffeeCups?.length || body.deletedCoffeeCupIds?.length) {
        statements.push(
          env.DB.prepare('UPDATE active_timers SET coffee_version = COALESCE(coffee_version, 1) + 1 WHERE user_id = ?').bind(currentUserId)
        );
      }
      if (body.sessions?.length) {
        const sorted = [...body.sessions].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
        if (sorted[0]?.completedAt) {
          statements.push(
            env.DB.prepare('UPDATE active_timers SET last_session_completed_at = ? WHERE user_id = ?').bind(sorted[0].completedAt, currentUserId)
          );
        }
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
