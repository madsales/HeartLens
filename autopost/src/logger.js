const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const COLORS = {
  debug: '\u001b[90m',
  info: '\u001b[36m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
};
const RESET = '\u001b[0m';

// Anything that looks like a credential is masked before it can reach a log
// line, a dashboard response, or the on-disk history file.
const SECRET_HINT = /(token|secret|password|key|bearer|cookie|refresh)/i;

export function redact(value, depth = 0) {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SECRET_HINT.test(key) ? maskSecret(inner) : redact(inner, depth + 1);
  }
  return out;
}

export function maskSecret(value) {
  if (typeof value !== 'string' || value === '') return value ? '***' : value;
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}

export function createLogger({ level = 'info', color = process.stdout.isTTY } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const emit = (lvl, message, meta) => {
    if ((LEVELS[lvl] ?? 0) < threshold) return;
    const stamp = new Date().toISOString();
    const tag = lvl.toUpperCase().padEnd(5);
    const head = color ? `${COLORS[lvl] ?? ''}${tag}${RESET}` : tag;
    const line = `${stamp} ${head} ${message}`;
    const stream = LEVELS[lvl] >= LEVELS.warn ? process.stderr : process.stdout;
    stream.write(meta === undefined ? `${line}\n` : `${line} ${JSON.stringify(redact(meta))}\n`);
  };

  return {
    level,
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
  };
}

export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
});
