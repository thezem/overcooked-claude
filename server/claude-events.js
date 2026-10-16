/**
 * Translates Claude Code transcript lines (~/.claude/projects/<cwd>/<sessionId>.jsonl and
 * <sessionId>/subagents/agent-*.jsonl) into the Copilot-shaped events the kitchen normalizer
 * (public/shared/normalize.js) already understands. The normalizer, director and scene stay untouched.
 *
 * Claude transcript facts this relies on (checked against real files):
 *  - one content block per line: an assistant message arrives as several lines (text / thinking / tool_use)
 *  - tool results are `user` lines holding `tool_result` blocks; failures carry `is_error: true`
 *    and Bash failures start with "Exit code N"
 *  - a turn ends on an assistant line with a non-null stop_reason other than "tool_use"
 *  - an interrupt is a user text "[Request interrupted by user…]"
 *  - sub-agents live in their own files; <agent>.meta.json holds { agentType, description, toolUseId }
 */

/** Cheap pre-filter: skip the huge api-request-blob / attachment lines without JSON.parse. */
export function wantsClaudeLine(line) {
  if (line.startsWith('{"type":"api-') || line.startsWith('{"type":"attachment"')) return false;
  return (
    line.includes('"type":"user"') ||
    line.includes('"type":"assistant"') ||
    line.includes('"type":"system"') ||
    line.includes('"type":"ai-title"') ||
    line.includes('"type":"custom-title"')
  );
}

// Claude tool name -> name the shared station classifier already knows.
const TOOL_ALIAS = {
  webfetch: 'web_fetch',
  websearch: 'web_search',
  agent: 'task',
  task: 'task',
  askuserquestion: 'ask_user',
  notebookedit: 'notebook_edit',
  exitplanmode: 'exit_plan_mode',
  toolsearch: 'tool_search_tool',
  todowrite: 'todo_write',
  taskcreate: 'todo_write',
  taskupdate: 'todo_write',
  tasklist: 'todo_write',
  taskget: 'todo_write',
  taskoutput: 'read_bash',
  taskstop: 'stop_bash',
  killshell: 'stop_bash',
  bashoutput: 'read_bash',
  monitor: 'read_bash',
  schedulewakeup: 'plan',
  croncreate: 'plan',
  enterplanmode: 'plan',
  enterworktree: 'plan',
  exitworktree: 'plan',
};

/** `mcp__server__tool` -> `server-tool` (the shape the classifier's MCP heuristics expect). */
export function mapToolName(name) {
  const n = String(name || 'tool');
  const mcp = /^mcp__(.+?)__(.+)$/.exec(n);
  if (mcp) return `${mcp[1].replace(/^claude_ai_/, '')}-${mcp[2]}`;
  return TOOL_ALIAS[n.toLowerCase()] || n;
}

const SYSTEM_TAG = /^<(local-command|system-reminder|task-notification|command-message|bash-|user-prompt-submit-hook)/;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

function resultTextOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
  return '';
}

/** A denied permission or interrupted tool is the user's call, not a kitchen fire. */
const USER_CANCEL = /doesn't want to proceed|was rejected|Request interrupted|user rejected|permission to use .* has been denied/i;

export class ClaudeTranslator {
  /** @param {string} sessionId */
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.started = false;
    /** Newest metadata seen in the transcript, for SessionTracker.setMeta(). */
    this.meta = { name: null, cwd: null, branch: null, client: null, model: null, repo: null };
    /** toolUseIds of tool calls whose result has been seen (used to close sub-agents). */
    this.finishedToolUses = new Set();
    /** toolUseIds that spawned a sub-agent (Agent / Task tools). */
    this.agentToolUses = new Set();
  }

  /**
   * @param {object} d parsed transcript line
   * @param {string|null} agentId set when the line comes from a sub-agent file
   * @returns {object[]} Copilot-shaped events
   */
  translate(d, agentId = null) {
    if (!d || typeof d !== 'object') return [];
    const out = [];
    const ts = d.timestamp;
    const ev = (type, data = {}) => {
      const e = { type, timestamp: ts, data };
      if (agentId) e.agentId = agentId;
      return e;
    };

    if (d.type === 'ai-title' || d.type === 'custom-title') {
      const t = d.aiTitle || d.customTitle || d.title;
      if (t && (d.type === 'custom-title' || !this.meta.nameIsCustom)) {
        this.meta.name = String(t);
        if (d.type === 'custom-title') this.meta.nameIsCustom = true;
      }
      return out;
    }

    if (!agentId) this.noteMeta(d);

    if (!this.started && !agentId && d.timestamp) {
      this.started = true;
      out.push(ev('session.start', {
        startTime: d.timestamp,
        selectedModel: this.meta.model,
        context: { cwd: this.meta.cwd, repository: this.meta.repo, branch: this.meta.branch },
      }));
    }

    const msg = d.message || {};

    if (d.type === 'system') {
      if (d.subtype === 'compact_boundary' && !agentId) {
        out.push(ev('session.compaction_start'), ev('session.compaction_complete'));
      }
      return out;
    }

    if (d.type === 'user') {
      const content = msg.content;
      // Tool results
      if (Array.isArray(content)) {
        for (const b of content) {
          if (!b || b.type !== 'tool_result') continue;
          const text = resultTextOf(b.content);
          const cancelled = b.is_error && USER_CANCEL.test(text.slice(0, 300));
          const failed = !!b.is_error && !cancelled;
          if (!agentId) this.finishedToolUses.add(b.tool_use_id);
          out.push(ev('tool.execution_complete', {
            toolCallId: b.tool_use_id,
            success: !failed,
            error: failed ? { message: text.split('\n')[0].slice(0, 160) || 'Tool failed' } : undefined,
            result: { content: text.slice(-400) },
          }));
        }
      }
      // Human / queued prompt text
      const text = textOf(content).trim();
      if (text && !d.isMeta && !d.toolUseResult) {
        if (/^\[Request interrupted/.test(text)) {
          if (!agentId) out.push(ev('abort'));
        } else if (agentId) {
          out.push(ev('user.message', { content: text }));
        } else if (!SYSTEM_TAG.test(text)) {
          const id = d.promptId || d.uuid;
          out.push(ev('user.message', { content: text, interactionId: id }));
          out.push(ev('assistant.turn_start', { interactionId: id }));
        }
      }
      return out;
    }

    if (d.type === 'assistant') {
      if (msg.model && !agentId && msg.model !== this.meta.model && msg.model !== '<synthetic>') {
        this.meta.model = msg.model;
      }
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      let text = '';
      const toolUses = [];
      for (const b of blocks) {
        if (b?.type === 'text' && typeof b.text === 'string') text += (text ? '\n' : '') + b.text;
        else if (b?.type === 'tool_use') toolUses.push(b);
      }
      if (text || (!toolUses.length && msg.stop_reason)) {
        out.push(ev('assistant.message', { content: text, toolRequests: toolUses.length ? toolUses.map((t) => ({ name: t.name })) : [] }));
      }
      for (const t of toolUses) {
        if (!agentId && /^(agent|task)$/i.test(t.name)) this.agentToolUses.add(t.id);
        out.push(ev('tool.execution_start', {
          toolCallId: t.id,
          toolName: mapToolName(t.name),
          arguments: mapArgs(t.name, t.input),
        }));
      }
      const ended = msg.stop_reason && msg.stop_reason !== 'tool_use';
      if (ended && !agentId) out.push(ev('assistant.turn_end'));
      return out;
    }

    return out;
  }

  noteMeta(d) {
    if (d.cwd && d.cwd !== this.meta.cwd) {
      this.meta.cwd = d.cwd;
      this.meta.repo = d.cwd.split('/').filter(Boolean).slice(-2).join('/');
    }
    if (d.gitBranch && d.gitBranch !== 'HEAD') this.meta.branch = d.gitBranch;
    if (d.entrypoint) this.meta.client = d.entrypoint;
  }
}

function mapArgs(name, input) {
  const a = input && typeof input === 'object' ? input : {};
  const lower = String(name).toLowerCase();
  if (lower === 'webfetch') return { url: a.url };
  if (lower === 'websearch') return { query: a.query };
  return a;
}

/** Event that starts a sous-chef for a sub-agent file. */
export function subagentStartEvent(agentId, meta, firstTimestamp) {
  return {
    type: 'subagent.started',
    timestamp: firstTimestamp,
    agentId,
    data: {
      agentName: meta?.agentType || 'agent',
      agentDisplayName: meta?.description || meta?.agentType || 'Sous-chef',
      toolCallId: meta?.toolUseId || null,
    },
  };
}

export function subagentEndEvent(agentId, meta, timestamp) {
  return { type: 'subagent.completed', timestamp, agentId, data: { agentDisplayName: meta?.description || null } };
}
