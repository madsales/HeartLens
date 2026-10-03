// Library entry point, for embedding the poster in another Node program
// rather than driving it from the CLI.
//
//   import { loadConfig, Store, publishPost, createLogger } from './autopost/src/index.js';
//
//   const config = loadConfig();
//   const store = new Store(config.dataDir);
//   await publishPost({ text: 'Hello' }, { config, store, logger: createLogger() });

export { loadConfig, PKG_ROOT } from './config.js';
export { createLogger, logger, redact, maskSecret } from './logger.js';
export { Store } from './store.js';
export { Scheduler } from './scheduler.js';
export { publishPost, contentHash } from './publisher.js';
export { createApp, serve } from './server.js';
export { parseCron, cronMatches, nextRun, describeCron, zonedParts } from './cron.js';
export { loadPack, materialise, nextFromPack, render, templateVars, DEFAULT_PACK } from './content.js';
export { ADAPTERS, BY_ID, getAdapter, resolveTargets, statusReport } from './platforms/index.js';
export { defineAdapter, TIERS, textFor, withLink, truncate, splitThread, loadMedia, multipart } from './platforms/base.js';
export { request, postJson, postForm, HttpError } from './http.js';
