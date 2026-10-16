import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileTailer } from '../server/tail.js';
import { parseFlatYaml, workspaceMeta } from '../server/yaml.js';
import { parseArgs, parseSince, defaultStateDir } from '../server/config.js';
import { allowedHostnames, hostnameOf, safeJoin } from '../server/server.js';
import { browserCommand, openBrowser } from '../server/open.js';

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function tmpFile(name = 'f.jsonl') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-tail-'));
  tmpDirs.push(dir);
  return path.join(dir, name);
}

test('FileTailer emits only complete lines, across appends and split UTF-8', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{"a":1}\n{"b":');
  const t = new FileTailer(file);
  const lines = [];
  await t.readNew((l) => lines.push(l));
  assert.deepEqual(lines, ['{"a":1}']);
  // Split a multi-byte character across two writes.
  const emoji = Buffer.from('🍣');
  fs.appendFileSync(file, Buffer.concat([Buffer.from('2}\r\n{"c":"'), emoji.subarray(0, 2)]));
  await t.readNew((l) => lines.push(l));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  fs.appendFileSync(file, Buffer.concat([emoji.subarray(2), Buffer.from('"}\n')]));
  await t.readNew((l) => lines.push(l));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":"🍣"}']);
  assert.equal(await t.readNew((l) => lines.push(l)), 0);
});

test('FileTailer restarts after truncation and can start near the end', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'one\ntwo\nthree\n');
  const t = new FileTailer(file);
  await t.readNew(() => {});
  fs.writeFileSync(file, 'new\n');
  const lines = [];
  await t.readNew((l) => lines.push(l));
  assert.deepEqual(lines, ['new']);

  fs.writeFileSync(file, 'aaaa\nbbbb\ncccc\n');
  const t2 = new FileTailer(file);
  await t2.startNear(7); // lands mid-"bbbb"; that partial line is dropped
  const tail = [];
  await t2.readNew((l) => tail.push(l));
  assert.deepEqual(tail, ['cccc']);

  const t3 = new FileTailer(file);
  await t3.seekToEnd();
  assert.equal(await t3.readNew(() => assert.fail('no lines expected')), 0);
});

test('FileTailer tolerates missing files', async () => {
  const t = new FileTailer(path.join(os.tmpdir(), 'does-not-exist-kitchen.jsonl'));
  assert.equal(await t.readNew(() => {}), 0);
});

test('parseFlatYaml + workspaceMeta read Copilot workspace.yaml', () => {
  const ws = parseFlatYaml([
    'id: cd5dbfdf-9c98-41e1-bddd-752b5970bee5',
    'cwd: C:\\Users\\me\\repo',
    'repository: patniko/overcooked-agents',
    'branch: main',
    'client_name: github/autopilot',
    'name: "Overcooked: agent visualizer"',
    "summary: 'it''s quoted'",
    'user_named: true',
    'summary_count: 0',
    'notes: |',
    '  line one',
    '  line two',
    'empty:',
    'nothing: null',
  ].join('\r\n'));
  assert.equal(ws.cwd, 'C:\\Users\\me\\repo');
  assert.equal(ws.name, 'Overcooked: agent visualizer');
  assert.equal(ws.summary, "it's quoted");
  assert.equal(ws.user_named, true);
  assert.equal(ws.notes, 'line one\nline two');
  assert.equal(ws.empty, '');
  assert.equal(ws.nothing, null);
  const meta = workspaceMeta(ws);
  assert.equal(meta.client, 'app');
  assert.equal(meta.repo, 'patniko/overcooked-agents');
  assert.equal(workspaceMeta({ name: 'New session', client_name: 'github/cli' }).name, null);
  assert.equal(workspaceMeta({ client_name: 'github/cli' }).client, 'cli');
});

test('config: args, --since, state dir', () => {
  assert.deepEqual(
    { ...parseArgs(['--port', '9000', '--open', '--since', '2h'], {}) },
    { port: 9000, host: '127.0.0.1', open: true, demo: false, since: '2h', recent: 20, poll: 500, stateDir: null, source: 'claude', claudeDir: null, help: false },
  );
  assert.equal(parseArgs([], { PORT: '8123' }).port, 8123);
  assert.throws(() => parseArgs(['--bogus']), /Unknown option/);
  assert.throws(() => parseArgs(['--port']), /Missing value/);
  assert.throws(() => parseArgs(['--port', 'abc']), /Invalid --port/);
  const now = new Date('2026-10-14T15:30:00');
  assert.equal(parseSince('all', now), 0);
  assert.equal(parseSince('today', now), new Date('2026-10-14T00:00:00').getTime());
  assert.equal(parseSince('90m', now), now.getTime() - 90 * 60e3);
  assert.equal(parseSince('2d', now), now.getTime() - 2 * 86400e3);
  assert.equal(parseSince('2026-10-01T00:00:00Z', now), Date.parse('2026-10-01T00:00:00Z'));
  assert.throws(() => parseSince('yesterday-ish', now), /Invalid --since/);
  assert.equal(defaultStateDir({ COPILOT_HOME: path.join('x', 'y') }), path.join('x', 'y', 'session-state'));
});

test('server helpers: host allow-list and safe static paths', () => {
  const allowed = allowedHostnames('127.0.0.1');
  assert.ok(allowed.has(hostnameOf('localhost:7425')));
  assert.ok(allowed.has(hostnameOf('127.0.0.1:7425')));
  assert.ok(allowed.has(hostnameOf('[::1]:7425')));
  assert.ok(!allowed.has(hostnameOf('evil.example:7425')));
  assert.ok(allowedHostnames('192.168.1.5').has('192.168.1.5'));
  const base = path.resolve(os.tmpdir(), 'kitchen-public');
  assert.equal(safeJoin(base, '/js/main.js'), path.join(base, 'js', 'main.js'));
  assert.equal(safeJoin(base, '/../secret.txt'), null);
  assert.equal(safeJoin(base, '/%2e%2e/secret.txt'), null);
  assert.equal(safeJoin(base, '/..%5csecret.txt'), process.platform === 'win32' ? null : path.join(base, '..\\secret.txt'));
  assert.equal(safeJoin(base, '/%E0%A4%A'), null);
});

test('browserCommand picks the platform opener', () => {
  assert.deepEqual(browserCommand('http://x/', 'win32'), ['rundll32', ['url.dll,FileProtocolHandler', 'http://x/']]);
  assert.deepEqual(browserCommand('http://x/', 'darwin'), ['open', ['http://x/']]);
  assert.deepEqual(browserCommand('http://x/', 'linux'), ['xdg-open', ['http://x/']]);
});

test('openBrowser reports a missing opener instead of crashing the server', async () => {
  // Like xdg-open on a headless Linux box: spawn() returns, then the child emits 'error' asynchronously.
  const err = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no error reported')), 5000);
    openBrowser('http://127.0.0.1:1/', {
      command: ['agent-kitchen-no-such-browser-opener', []],
      onError: (e) => {
        clearTimeout(timer);
        resolve(e);
      },
    });
  });
  assert.equal(err.code, 'ENOENT');
});
