#!/usr/bin/env node
/**
 * End-to-end check for the Claude Code adapter.
 *
 * Builds a throwaway ~/.claude (a registry entry + a transcript + a sub-agent transcript), boots the real
 * server against it, appends transcript lines the way Claude Code does, asserts the kitchen state over
 * /api/state, and takes screenshots of the real browser UI into docs/e2e/.
 *
 *   node scripts/e2e-claude.js
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'e2e');
const PORT = 7461;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-e2e-'));
const SID = '11111111-2222-4333-8444-555555555555';
const proj = path.join(claudeDir, 'projects', '-home-me-sushi-app');
const sessionFile = path.join(proj, `${SID}.jsonl`);
const subDir = path.join(proj, SID, 'subagents');
fs.mkdirSync(proj, { recursive: true });
fs.mkdirSync(subDir, { recursive: true });
fs.mkdirSync(path.join(claudeDir, 'sessions'), { recursive: true });
fs.writeFileSync(path.join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({
  pid: process.pid, sessionId: SID, cwd: '/home/me/sushi-app', status: 'busy', name: 'sushi-app', entrypoint: 'cli',
}));

let n = 0;
const base = () => ({ sessionId: SID, cwd: '/home/me/sushi-app', gitBranch: 'main', entrypoint: 'cli', timestamp: new Date().toISOString(), uuid: `u${++n}` });
const append = (file, obj) => fs.appendFileSync(file, JSON.stringify(obj) + '\n');
const userPrompt = (text) => append(sessionFile, { ...base(), type: 'user', isSidechain: false, promptId: `p${n}`, message: { role: 'user', content: text } });
const toolUse = (id, name, input, file = sessionFile, extra = {}) => append(file, { ...base(), ...extra, type: 'assistant', message: { model: 'claude-sonnet-5-5', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, isError = false, file = sessionFile, extra = {}) => append(file, { ...base(), ...extra, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] }, toolUseResult: {} });
const finalText = (text) => append(sessionFile, { ...base(), type: 'assistant', message: { model: 'claude-sonnet-5-5', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function state() {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/state`);
  return (await r.json()).sessions.find((s) => s.id === SID);
}
async function until(fn, label, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`timed out waiting for: ${label}`);
}
/** Screenshot a page that stays open while `during()` appends events, so animations actually play. */
function shotDuring(name, wait, during, afterMs) {
  const done = shot(name, wait);
  setTimeout(() => during().catch((e) => console.error(e)), afterMs);
  return done;
}
function shot(name, wait = 2500) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'shot.js'), `http://127.0.0.1:${PORT}/?nointro&sound=0`, path.join(OUT, name), '--wait', String(wait)], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`shot ${name} failed (${c})`))));
  });
}

fs.mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js'), '--port', String(PORT), '--claude-dir', claudeDir, '--since', 'all', '--poll', '100'], { stdio: 'inherit' });
let failed = false;
try {
  await until(async () => (await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.json()).catch(() => null))?.ready, 'server ready');

  // 1. a prompt arrives and the chef reads code
  userPrompt('Add a spicy tuna roll and make sure tests pass');
  const t0 = Date.now();
  toolUse('t1', 'Read', { file_path: '/home/me/sushi-app/src/menu.ts' });
  let s = await until(async () => { const x = await state(); return x?.orders.length && x.tools.length ? x : null; }, 'order + tool');
  check('prompt becomes an order ticket', s.orders[0].text.includes('spicy tuna'));
  check('Read goes to the nori crate (read)', s.tools[0].station === 'read', s.tools[0].label);
  check('chef is working, client + branch picked up', s.status === 'working' && s.client === 'cli' && s.branch === 'main', `${s.status}/${s.client}/${s.branch}`);
  await shot('1-reading.png');

  // 2. edit, then a failing test run → fire at the fryer
  toolResult('t1', 'file contents');
  toolUse('t2', 'Edit', { file_path: '/home/me/sushi-app/src/menu.ts', old_string: 'a', new_string: 'b' });
  toolResult('t2', 'edited');
  toolUse('t3', 'Bash', { command: 'npm test', description: 'Run tests' });
  toolResult('t3', 'Exit code 1\nFAIL menu.test.ts', true);
  s = await until(async () => { const x = await state(); return x?.fire ? x : null; }, 'fire');
  check('failed `npm test` sets the tempura fryer on fire', s.fire.station === 'test', `${s.fire.station}: ${s.fire.message}`);
  await shot('2-fire.png', 1800);

  // 3. an Agent call → sous-chef from the sub-agent transcript
  toolUse('t4', 'Agent', { description: 'Check menu prices', prompt: 'look at prices', subagent_type: 'Explore' });
  const agentId = 'aaaa1111bbbb2222c';
  fs.writeFileSync(path.join(subDir, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: 'Explore', description: 'Check menu prices', toolUseId: 't4' }));
  const subFile = path.join(subDir, `agent-${agentId}.jsonl`);
  append(subFile, { ...base(), type: 'user', isSidechain: true, agentId, message: { role: 'user', content: 'look at prices' } });
  toolUse('s1', 'Grep', { pattern: 'price' }, subFile, { isSidechain: true, agentId });
  s = await until(async () => { const x = await state(); return x?.subagents.length ? x : null; }, 'sous-chef', 10000);
  check('Agent call spawns a sous-chef', s.subagents[0].displayName === 'Check menu prices');
  s = await until(async () => { const x = await state(); return x?.tools.some((t) => t.agentId) ? x : null; }, 'sub tool');
  check('sous-chef grep goes to the fish crate (search)', s.tools.find((t) => t.agentId).station === 'search');
  await shot('3-sous-chef.png', 2200);

  // 4. sub-agent returns, final answer → order served
  toolResult('s1', 'price: 12', false, subFile, { isSidechain: true, agentId });
  toolResult('t4', 'Prices look fine');
  s = await until(async () => { const x = await state(); return x && !x.subagents.length ? x : null; }, 'sous-chef leaves');
  check('sous-chef leaves when the Agent result returns', true);
  finalText('Done! The spicy tuna roll is on the menu and tests are updated.');
  s = await until(async () => { const x = await state(); return x && x.stats.served >= 1 ? x : null; }, 'served');
  check('end_turn serves the order for coins', s.stats.served === 1 && s.stats.coins >= 20, `${s.stats.coins} coins in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check('chef goes idle after the answer', s.status === 'idle', s.status);
  await shot('4-served.png', 1500);

  // 5. an interrupt cancels the next order
  userPrompt('Now refactor everything');
  toolUse('t5', 'Bash', { command: 'git reset --hard' });
  append(sessionFile, { ...base(), type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
  s = await until(async () => { const x = await state(); return x && x.stats.aborted >= 1 ? x : null; }, 'abort');
  check('"[Request interrupted by user]" cancels the order (-10 coins)', s.stats.aborted === 1);

  // 6. persistent page: a new prompt, then a failing build, all while the browser watches
  await shotDuring('5-live-fire.png', 14000, async () => {
    userPrompt('Ship it');
    toolUse('t6', 'Bash', { command: 'npm run build', description: 'Build' });
    await sleep(2500);
    toolResult('t6', 'Exit code 2\nerror TS2345', true);
  }, 3500);
  s = await state();
  check('live page: failed `npm run build` is recorded as a fire', s.stats.fires >= 2, `${s.stats.fires} fires`);
} catch (err) {
  failed = true;
  console.error('E2E error:', err.message);
} finally {
  server.kill('SIGTERM');
  fs.rmSync(claudeDir, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} checks passed. Screenshots: ${path.relative(ROOT, OUT)}/`);
process.exit(failed || bad ? 1 : 0);
