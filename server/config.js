import os from 'node:os';
import path from 'node:path';

export const HELP = `Agent Kitchen — an Overcooked-inspired live view of your Claude Code agents

Usage: node server/index.js [options]

Options:
  --port <n>          Port to listen on (default 7425, or $PORT)
  --host <addr>       Interface to bind (default 127.0.0.1; use 0.0.0.0 to share on your LAN)
  --open              Open the kitchen in your default browser
  --demo              Open the browser in demo mode (simulated agents)
  --source <name>     claude (default) or copilot
  --claude-dir <dir>  Claude config folder (default $CLAUDE_CONFIG_DIR or ~/.claude)
  --state-dir <dir>   Copilot session-state folder, for --source copilot
                      (default $COPILOT_HOME/session-state or ~/.copilot/session-state)
  --since <when>      Count coins/orders since: today (default), all, 30m, 4h, 2d, or a date
  --recent <minutes>  Keep recently finished sessions in the roster this long (default 20)
  --poll <ms>         How often to check for new events (default 500)
  -h, --help          Show this help
`;

export function parseArgs(argv, env = process.env) {
  const opts = {
    port: Number(env.PORT) || 7425,
    host: '127.0.0.1',
    open: false,
    demo: false,
    since: 'today',
    recent: 20,
    poll: 500,
    stateDir: null,
    source: 'claude',
    claudeDir: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--port': opts.port = Number(next()); break;
      case '--host': opts.host = next(); break;
      case '--open': opts.open = true; break;
      case '--demo': opts.demo = true; break;
      case '--state-dir': opts.stateDir = next(); break;
      case '--source': opts.source = next(); break;
      case '--claude-dir': opts.claudeDir = next(); break;
      case '--since': opts.since = next(); break;
      case '--recent': opts.recent = Number(next()); break;
      case '--poll': opts.poll = Number(next()); break;
      case '-h': case '--help': opts.help = true; break;
      default: throw new Error(`Unknown option: ${a}`);
    }
  }
  if (!['claude', 'copilot'].includes(opts.source)) throw new Error('Invalid --source (claude or copilot)');
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) throw new Error('Invalid --port');
  if (!(opts.recent >= 0)) throw new Error('Invalid --recent');
  if (!(opts.poll >= 50)) throw new Error('Invalid --poll (minimum 50ms)');
  return opts;
}

export function parseSince(value, now = new Date()) {
  const v = String(value || 'today').trim().toLowerCase();
  if (v === 'all') return 0;
  if (v === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d|day)s?$/.exec(v);
  if (m) {
    const unit = { m: 60e3, min: 60e3, h: 3600e3, hr: 3600e3, d: 86400e3, day: 86400e3 }[m[2]];
    return now.getTime() - Number(m[1]) * unit;
  }
  const t = Date.parse(value);
  if (Number.isFinite(t)) return t;
  throw new Error(`Invalid --since value: ${value}`);
}

export function defaultStateDir(env = process.env) {
  const home = env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
  return path.join(home, 'session-state');
}

export function defaultClaudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
