type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

// Keys whose values must never be written to logs (secrets / credentials / PII).
// Matched case-insensitively as substrings of the key name.
const REDACT_KEY_PATTERNS = [
  'password', 'passwd', 'secret', 'token', 'authorization', 'auth', 'cookie',
  'apikey', 'api_key', 'jwt', 'refreshtoken', 'accesstoken', 'privatekey',
  'signature', 'otp', 'cvv', 'card', 'pan', 'ssn', 'credential', 'session'
];

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

function shouldRedactKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACT_KEY_PATTERNS.some((p) => lower.includes(p));
}

// Recursively redact sensitive keys. Bounded depth + WeakSet guard against cyclic
// or pathological structures so logging can never throw or hang.
function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return '[TRUNCATED]';
  }
  if (seen.has(value as object)) {
    return '[CIRCULAR]';
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = shouldRedactKey(k) ? REDACTED : redact(v, depth + 1, seen);
  }
  return out;
}

function write(entry: LogEntry) {
  const safeContext = entry.context ? (redact(entry.context) as Record<string, unknown>) : undefined;
  const payload = {
    timestamp: new Date().toISOString(),
    level: entry.level,
    message: entry.message,
    ...(safeContext ?? {})
  };

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    serialized = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: entry.level,
      message: entry.message,
      context: '[UNSERIALIZABLE]'
    });
  }

  if (entry.level === 'error') {
    console.error(serialized);
    return;
  }

  if (entry.level === 'warn') {
    console.warn(serialized);
    return;
  }

  console.info(serialized);
}

export const logger = {
  info(message: string, context?: Record<string, unknown>) {
    write({ level: 'info', message, context });
  },
  warn(message: string, context?: Record<string, unknown>) {
    write({ level: 'warn', message, context });
  },
  error(message: string, context?: Record<string, unknown>) {
    write({ level: 'error', message, context });
  },
  request(context: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
    requestId?: string;
    tenantId?: string;
  }) {
    write({
      level: 'info',
      message: 'request completed',
      context
    });
  }
};
