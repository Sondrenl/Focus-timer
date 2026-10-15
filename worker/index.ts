import { signJwt, verifyJwt, verifyGoogleToken } from './auth';

interface Env {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  GOOGLE_CLIENT_ID?: string;
  AUTH_SECRET?: string;
}

const DEFAULT_AUTH_SECRET = 'pomodor-focus-timer-secret-jwt-key-2025';
const DEFAULT_CLIENT_ID = '229654613287-8utvd3fhrcsalh1ol02ev2mlg140kbai.apps.googleusercontent.com';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  avatar_emoji TEXT DEFAULT '',
  daily_goal_minutes INTEGER DEFAULT 120,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  is_archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);

CREATE TABLE IF NOT EXISTS deleted_tags (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL,
  deleted_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_deleted_tags_user ON deleted_tags(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id TEXT,
  session_type TEXT NOT NULL CHECK(session_type IN ('WORK', 'SHORT_BREAK', 'LONG_BREAK')),
  duration_seconds INTEGER NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, completed_at);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  work_duration_minutes INTEGER DEFAULT 25,
  short_break_duration_minutes INTEGER DEFAULT 5,
  long_break_duration_minutes INTEGER DEFAULT 25,
  long_break_interval INTEGER DEFAULT 4,
  auto_start_breaks INTEGER DEFAULT 0,
  auto_start_pomodoros INTEGER DEFAULT 0,
  sound_enabled INTEGER DEFAULT 1,
  sound_volume REAL DEFAULT 0.8,
  notifications_enabled INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

let isSchemaEnsured = false;

async function ensureSchema(db: D1Database): Promise<void> {
  if (isSchemaEnsured) return;
  try {
    await db.exec(SCHEMA_SQL);
    isSchemaEnsured = true;
  } catch (err) {
    console.error('Error ensuring schema:', err);
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authSecret = env.AUTH_SECRET || DEFAULT_AUTH_SECRET;
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
          await env.DB.prepare('SELECT 1').first();
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
        env.DB.prepare('DELETE FROM tags WHERE user_id = ? AND id = ?').bind(currentUserId, tagId),
        env.DB.prepare('INSERT OR REPLACE INTO deleted_tags (user_id, tag_id) VALUES (?, ?)').bind(currentUserId, tagId),
      ]);

      return new Response(JSON.stringify({ success: true, deletedTagId: tagId }), { headers: corsHeaders });
    }

    // GET /api/sync — Fetch all cloud user data
    if (url.pathname === '/api/sync' && request.method === 'GET') {
      if (!currentUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }

      const [userRow, tagRows, sessionRows, settingsRow, deletedTagRows] = await Promise.all([
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
        }>(),
        env.DB.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY completed_at DESC').bind(currentUserId).all<{
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
        }>(),
        env.DB.prepare('SELECT tag_id FROM deleted_tags WHERE user_id = ?').bind(currentUserId).all<{
          tag_id: string;
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
          }
        : null;

      const deletedTagIds = (deletedTagRows.results || []).map((r) => r.tag_id);

      return new Response(
        JSON.stringify({
          profile,
          tags,
          sessions,
          settings,
          deletedTagIds,
          syncedAt: new Date().toISOString(),
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
        }>;
        deletedTagIds?: string[];
        sessions?: Array<{
          id: string;
          tagId: string | null;
          sessionType: string;
          durationSeconds: number;
          completedAt: string;
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
        // Full override: delete existing sessions, tags, and deleted tag records for this user
        await env.DB.batch([
          env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(currentUserId),
          env.DB.prepare('DELETE FROM tags WHERE user_id = ?').bind(currentUserId),
          env.DB.prepare('DELETE FROM deleted_tags WHERE user_id = ?').bind(currentUserId),
        ]);
      } else if (body.clearSessions) {
        await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(currentUserId).run();
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

      // 3. Upsert Tags (excluding any that were deleted)
      const deletedSet = body.mode === 'replace' ? new Set<string>() : new Set(body.deletedTagIds || []);
      if (Array.isArray(body.tags) && body.tags.length > 0) {
        for (const tag of body.tags) {
          if (deletedSet.has(tag.id)) continue;
          statements.push(
            env.DB.prepare(
              `INSERT INTO tags (id, user_id, name, color, is_archived, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 color = excluded.color,
                 is_archived = excluded.is_archived,
                 updated_at = CURRENT_TIMESTAMP`
            ).bind(
              tag.id,
              currentUserId,
              tag.name,
              tag.color,
              tag.isArchived ? 1 : 0,
              tag.createdAt || new Date().toISOString()
            )
          );
        }
      }

      // 4. Upsert Sessions
      if (Array.isArray(body.sessions) && body.sessions.length > 0) {
        for (const session of body.sessions) {
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

      // 5. Upsert Settings
      if (body.settings) {
        const s = body.settings;
        statements.push(
          env.DB.prepare(
            `INSERT INTO user_settings (
               user_id, work_duration_minutes, short_break_duration_minutes, long_break_duration_minutes,
               long_break_interval, auto_start_breaks, auto_start_pomodoros, sound_enabled, sound_volume,
               notifications_enabled, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
            s.notificationsEnabled ? 1 : 0
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
          processedRecords: {
            tags: body.tags?.length || 0,
            sessions: body.sessions?.length || 0,
            deletedTags: body.deletedTagIds?.length || 0,
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
