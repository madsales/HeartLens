// Minimal .env loader. Avoids a dotenv dependency so the package installs
// with no network access and no node_modules at all.
import { readFileSync, existsSync } from 'node:fs';

const UNQUOTE = /^(['"])([\s\S]*)\1$/;

export function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = UNQUOTE.exec(value);
    if (quoted) {
      value = quoted[2];
      // Only expand escapes inside double quotes, matching dotenv behaviour.
      if (quoted[1] === '"') value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

// Loads `file` into process.env without clobbering variables that are
// already set, so a real environment always beats the file on disk.
export function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const parsed = parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return parsed;
}
