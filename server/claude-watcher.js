import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { FileTailer } from './tail.js';
import { isPidAlive } from './watcher.js';
import {
  ClaudeTranslator, wantsClaudeLine, subagentStartEvent, subagentEndEvent,
} from './claude-events.js';

const UUID_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const AGENT_FILE = /^agent-([\w-]+)\.jsonl$/;

/**
 * Watches Claude Code sessions and feeds them into a KitchenState.
 *
 *  - transcripts: <claudeDir>/projects/<cwd-slug>/<sessionId>.jsonl (+ <sessionId>/subagents/agent-*.jsonl)
 *  - live registry: <claudeDir>/sessions/<pid>.json  ({ sessionId, pid, status, name, cwd, entrypoint })
 *
 * Read-only: never writes to the Claude directory. Same interface as CopilotWatcher
 * ('update' { changed, fx }, 'warn', 'error', start(), stop(), ready).
 */
export class ClaudeWatcher extends EventEmitter {
  constructor({
    claudeDir,
    kitchen,
    since = 0,
    pollMs = 500,
    scanMs = 3000,
    graceMs = 5 * 60 * 1000,
    maxReplayBytes = 32 * 1024 * 1024,
    pidAlive = isPidAlive,
    now = () => Date.now(),
  }) {
    super();
    this.claudeDir = claudeDir;
    this.projectsDir = path.join(claudeDir, 'projects');
    this.registryDir = path.join(claudeDir, 'sessions');
    this.kitchen = kitchen;
    this.since = since;
    this.pollMs = pollMs;
    this.scanMs = scanMs;
    this.graceMs = graceMs;
    this.maxReplayBytes = maxReplayBytes;
    this.pidAlive = pidAlive;
    this.now = now;
    this.files = new Map(); // sessionId -> entry
    this.untracked = new Map(); // sessionId -> transcript mtime when last seen
    this.registry = new Map(); // sessionId -> { pid, status, name, ... }
    this.busy = false;
    this.missingWarned = false;
    this.ready = false;
  }

  async start() {
    await this.scan({ initial: true });
    this.ready = true;
    this.pollTimer = setInterval(() => this.exclusive(() => this.poll()), this.pollMs);
    this.scanTimer = setInterval(() => this.exclusive(() => this.scan({ initial: false })), this.scanMs);
    this.pollTimer.unref?.();
    this.scanTimer.unref?.();
  }

  stop() {
    clearInterval(this.pollTimer);
    clearInterval(this.scanTimer);
  }

  async exclusive(fn) {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
    } catch (err) {
      this.emit('error', err);
    } finally {
      this.busy = false;
    }
  }

  async loadRegistry() {
    let names;
    try {
      names = await fsp.readdir(this.registryDir);
    } catch {
      this.registry = new Map();
      return;
    }
    const next = new Map();
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      try {
        const r = JSON.parse(await fsp.readFile(path.join(this.registryDir, n), 'utf8'));
        if (r?.sessionId && this.pidAlive(Number(r.pid))) next.set(r.sessionId, r);
      } catch { /* half-written file; next scan will catch it */ }
    }
    this.registry = next;
  }

  /** Feed one transcript file's new lines through the translator into the tracker. */
  async pump(entry, tailer, agentId, fx, fxSince) {
    const tracker = this.kitchen.get(entry.id);
    await tailer.readNew((line) => {
      if (!wantsClaudeLine(line)) return;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        return;
      }
      for (const e of entry.tr.translate(d, agentId)) {
        const out = tracker.ingest(e);
        if (fx) for (const f of out) if (f.at >= fxSince) fx.push(f);
      }
      if (agentId) entry.lastSubTs = d.timestamp || entry.lastSubTs;
    });
    this.applyMeta(entry);
  }

  applyMeta(entry) {
    const m = entry.tr.meta;
    const reg = this.registry.get(entry.id);
    const name = m.nameIsCustom ? m.name : reg?.name || m.name;
    this.kitchen.get(entry.id).setMeta({ name, cwd: m.cwd || reg?.cwd, repo: m.repo, branch: m.branch, client: m.client || reg?.entrypoint, model: m.model });
  }

  async track(id, file, fx) {
    const tailer = new FileTailer(file);
    await tailer.startNear(this.maxReplayBytes);
    const entry = { id, file, tailer, tr: new ClaudeTranslator(id), subs: new Map(), lastSubTs: null };
    this.files.set(id, entry);
    this.untracked.delete(id);
    await this.pump(entry, tailer, null, fx, this.now() - 15_000);
    await this.discoverSubs(entry, fx, this.now() - 15_000);
    return entry;
  }

  /** Find sub-agent transcripts; each becomes a sous-chef that leaves when its parent tool call returns. */
  async discoverSubs(entry, fx, fxSince) {
    const dir = path.join(path.dirname(entry.file), entry.id, 'subagents');
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const m = AGENT_FILE.exec(n);
      if (!m || entry.subs.has(m[1])) continue;
      const agentId = m[1];
      const file = path.join(dir, n);
      let meta = null;
      try {
        meta = JSON.parse(await fsp.readFile(path.join(dir, `agent-${agentId}.meta.json`), 'utf8'));
      } catch { /* meta lands slightly after the transcript sometimes; fine to go without */ }
      let st;
      try {
        st = await fsp.stat(file);
      } catch {
        continue;
      }
      const sub = { agentId, file, meta, tailer: new FileTailer(file), ended: false };
      entry.subs.set(agentId, sub);
      const tracker = this.kitchen.get(entry.id);
      const startedAt = new Date(st.birthtimeMs || st.mtimeMs).toISOString();
      for (const f of tracker.ingest(subagentStartEvent(agentId, meta, startedAt))) if (fx && f.at >= fxSince) fx.push(f);
      await this.pump(entry, sub.tailer, agentId, fx, fxSince);
      await this.closeSubIfDone(entry, sub, fx, fxSince);
    }
  }

  async closeSubIfDone(entry, sub, fx, fxSince) {
    if (sub.ended) return;
    const tid = sub.meta?.toolUseId;
    if (!tid || !entry.tr.finishedToolUses.has(tid)) return;
    sub.ended = true;
    const at = entry.lastSubTs || new Date(this.now()).toISOString();
    for (const f of this.kitchen.get(entry.id).ingest(subagentEndEvent(sub.agentId, sub.meta, at))) {
      if (fx && f.at >= fxSince) fx.push(f);
    }
  }

  async refreshLiveness(entry) {
    const tracker = this.kitchen.get(entry.id);
    const registered = this.registry.has(entry.id);
    const alive = registered || (!tracker.ended && this.now() - tracker.lastEventAt < this.graceMs);
    return tracker.setAlive(alive);
  }

  async scan({ initial }) {
    await this.loadRegistry();
    let projects;
    try {
      projects = await fsp.readdir(this.projectsDir, { withFileTypes: true });
    } catch {
      if (!this.missingWarned) {
        this.missingWarned = true;
        this.emit('warn', `Claude projects directory not found: ${this.projectsDir}`);
      }
      return;
    }
    this.missingWarned = false;
    const changed = new Set();
    const fx = initial ? null : [];
    const present = new Set();

    for (const proj of projects) {
      if (!proj.isDirectory()) continue;
      const pdir = path.join(this.projectsDir, proj.name);
      let names;
      try {
        names = await fsp.readdir(pdir);
      } catch {
        continue;
      }
      for (const n of names) {
        const m = UUID_FILE.exec(n);
        if (!m) continue;
        const id = m[1].toLowerCase();
        present.add(id);
        if (this.files.has(id)) continue;
        const file = path.join(pdir, n);
        let st;
        try {
          st = await fsp.stat(file);
        } catch {
          continue;
        }
        const seen = this.untracked.get(id);
        let shouldTrack;
        if (seen === undefined) shouldTrack = st.mtimeMs >= this.since || this.registry.has(id);
        else shouldTrack = st.mtimeMs !== seen && st.mtimeMs >= this.since; // an old session woke up
        if (!shouldTrack) {
          this.untracked.set(id, st.mtimeMs);
          continue;
        }
        await this.track(id, file, fx);
        changed.add(id);
      }
    }

    for (const [id, entry] of this.files) {
      if (!present.has(id)) {
        const t = this.kitchen.get(id);
        if (!t.ended) {
          t.ended = true;
          t.setAlive(false);
          changed.add(id);
        }
        this.files.delete(id);
        continue;
      }
      const before = this.kitchen.get(id).version;
      await this.discoverSubs(entry, fx, 0);
      this.applyMeta(entry);
      if (await this.refreshLiveness(entry)) changed.add(id);
      if (this.kitchen.get(id).version !== before) changed.add(id);
    }

    if (!initial && (changed.size || fx.length)) this.emit('update', { changed: [...changed], fx });
  }

  async poll() {
    const changed = new Set();
    const fx = [];
    for (const [id, entry] of this.files) {
      const tracker = this.kitchen.get(id);
      const before = tracker.version;

      let st;
      try {
        st = await fsp.stat(entry.file);
      } catch {
        continue;
      }
      if (st.size !== entry.tailer.offset) await this.pump(entry, entry.tailer, null, fx, 0);

      // Sous-chefs: pick up new agent files quickly while a delegated call is open, then drain existing ones.
      const openAgentCalls = [...entry.tr.agentToolUses].some((t) => !entry.tr.finishedToolUses.has(t));
      if (openAgentCalls) await this.discoverSubs(entry, fx, 0);
      for (const sub of entry.subs.values()) {
        if (sub.ended) continue;
        await this.pump(entry, sub.tailer, sub.agentId, fx, 0);
        await this.closeSubIfDone(entry, sub, fx, 0);
      }

      if (tracker.version !== before) {
        changed.add(id);
        if (tracker.alive !== true && !tracker.ended) tracker.setAlive(true);
      }
    }
    if (changed.size || fx.length) this.emit('update', { changed: [...changed], fx });
  }
}
