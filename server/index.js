#!/usr/bin/env node
/**
 * Agent Kitchen: an Overcooked-inspired live view of the agents on this machine.
 * Run `node server/index.js --help` for options.
 */
import path from 'node:path';
import { KitchenState } from '../public/shared/normalize.js';
import { CopilotWatcher } from './watcher.js';
import { ClaudeWatcher } from './claude-watcher.js';
import { createKitchenServer } from './server.js';
import { HELP, defaultClaudeDir, defaultStateDir, parseArgs, parseSince } from './config.js';
import { openBrowser } from './open.js';

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n\n${HELP}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const claude = opts.source === 'claude';
  const stateDir = path.resolve(claude ? opts.claudeDir || defaultClaudeDir() : opts.stateDir || defaultStateDir());
  let since;
  try {
    since = parseSince(opts.since);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const kitchen = new KitchenState({ countFrom: since, recentMs: opts.recent * 60e3 });
  const watcher = claude
    ? new ClaudeWatcher({ claudeDir: stateDir, kitchen, since, pollMs: opts.poll })
    : new CopilotWatcher({ stateDir, kitchen, since, pollMs: opts.poll });
  watcher.on('warn', (msg) => console.warn(`⚠️  ${msg}`));
  watcher.on('error', (err) => console.error('watcher error:', err?.message || err));

  const t0 = Date.now();
  await watcher.start();
  const server = createKitchenServer({
    kitchen,
    watcher,
    host: opts.host,
    info: { mode: 'live', source: opts.source, stateDir, since, version: '0.1.0' },
  });
  server.on('handlerError', (err) => console.error('request error:', err?.message || err));
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${opts.port} is already in use. Try --port ${opts.port + 1}`);
    else console.error(err.message);
    process.exit(1);
  });

  server.listen(opts.port, opts.host, () => {
    const { port } = server.address();
    const wildcard = opts.host === '0.0.0.0' || opts.host === '::';
    const shownHost = wildcard ? 'localhost' : opts.host.includes(':') ? `[${opts.host}]` : opts.host;
    const url = `http://${shownHost}:${port}/${opts.demo ? '?demo' : ''}`;
    console.log('');
    console.log('  🍣  Agent Kitchen is open!');
    console.log(`  ➜  ${url}`);
    console.log(`  👀  Watching ${stateDir}`);
    console.log(`  🧑‍🍳  ${kitchen.sessions.size} session(s) loaded, ${kitchen.visible().length} in the kitchen now (${Date.now() - t0} ms)`);
    if (wildcard) console.log('  ⚠️  Bound to all interfaces: anyone on your network can see your agents\' prompts.');
    console.log('  Press Ctrl+C to close the kitchen.\n');
    if (opts.open) {
      openBrowser(url, { onError: () => console.log(`  (Couldn't open a browser automatically. Open ${url} yourself.)\n`) });
    }
  });

  const shutdown = async () => {
    watcher.stop();
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
