/**
 * Station catalog + classifiers.
 *
 * Every kind of SDLC work an agent does is mapped to a kitchen station, following
 * the sushi recipe: grab nori (read code), grab fish (search), chop it (write code),
 * cook rice (build), fry tempura (test), plate it (commit) and serve it (ship).
 *
 * Pure ESM with no Node/browser APIs so it runs on the server and in the browser.
 */

export const STATIONS = [
  { id: 'plan', short: 'Plan', kitchen: 'Recipe Book', sdlc: 'Plan & think', verb: 'Planning', item: 'ticket',
    examples: 'thinking, todos, memory, skills, delegating to sous-chefs' },
  { id: 'read', short: 'Read', kitchen: 'Nori Crate', sdlc: 'Read code', verb: 'Grabbing nori', item: 'nori',
    examples: 'view, cat, Get-Content, git diff / log / status' },
  { id: 'search', short: 'Search', kitchen: 'Fish Crate', sdlc: 'Search code', verb: 'Catching fish', item: 'fish',
    examples: 'grep, rg, glob, code search' },
  { id: 'research', short: 'Research', kitchen: 'Delivery Hatch', sdlc: 'Research', verb: 'Taking a delivery', item: 'parcel',
    examples: 'web_fetch, web_search, MCP servers, gh api, curl' },
  { id: 'install', short: 'Install', kitchen: 'Pantry', sdlc: 'Install dependencies', verb: 'Restocking', item: 'sack',
    examples: 'npm install, pip install, dotnet restore, go mod' },
  { id: 'code', short: 'Code', kitchen: 'Chopping Board', sdlc: 'Write code', verb: 'Chopping', item: 'sashimi',
    examples: 'edit, create, apply_patch' },
  { id: 'build', short: 'Build', kitchen: 'Rice Cooker', sdlc: 'Build', verb: 'Cooking rice', item: 'rice',
    examples: 'npm run build, tsc, dotnet build, cargo build, make' },
  { id: 'test', short: 'Test', kitchen: 'Tempura Fryer', sdlc: 'Run tests', verb: 'Frying', item: 'tempura',
    examples: 'npm test, pytest, go test, dotnet test, UI checks' },
  { id: 'lint', short: 'Lint', kitchen: 'Sink', sdlc: 'Lint & format', verb: 'Washing up', item: 'plate',
    examples: 'eslint, prettier, ruff, dotnet format, context compaction' },
  { id: 'commit', short: 'Commit', kitchen: 'Plating Counter', sdlc: 'Commit', verb: 'Plating', item: 'sushi',
    examples: 'git add, git commit, merge, rebase, stash' },
  { id: 'ship', short: 'Ship', kitchen: 'Serving Hatch', sdlc: 'Ship', verb: 'Serving', item: null,
    examples: 'git push, gh pr create, create_pull_request, task_complete' },
  { id: 'shell', short: 'Run', kitchen: 'Prep Station', sdlc: 'Run commands', verb: 'Prepping', item: 'bowl',
    examples: 'other shell commands, scripts, dev servers' },
  { id: 'trash', short: 'Delete', kitchen: 'Bin', sdlc: 'Delete & revert', verb: 'Binning', item: null,
    examples: 'rm, Remove-Item, git reset / clean / restore' },
  { id: 'ask', short: 'Ask you', kitchen: 'Order Bell', sdlc: 'Ask the user', verb: 'Waiting on you', item: null,
    examples: 'ask_user, permission prompts' },
];

export const STATION_BY_ID = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

/** When one shell command does several things, the "furthest along" step wins. */
export const SHELL_PRIORITY = {
  ship: 10, commit: 9, test: 8, build: 7, lint: 6, install: 5, trash: 4,
  research: 3, search: 2, read: 1, plan: 0.5, shell: 0,
};

const TOOL_MAP = {
  // plan: thinking, bookkeeping, coordination
  report_intent: 'plan', think: 'plan', update_todo: 'plan', todo_write: 'plan', todowrite: 'plan',
  manage_todo_list: 'plan', sql: 'plan', store_memory: 'plan', vote_memory: 'plan', read_memories: 'plan',
  session_store_sql: 'plan', skill: 'plan', task: 'plan', read_agent: 'plan', write_agent: 'plan',
  list_agents: 'plan', tool_search_tool: 'plan', exit_plan_mode: 'plan', update_plan: 'plan',
  rename_branch: 'plan', rename_session: 'plan', send_session_message: 'plan', create_session: 'plan',
  list_sessions_and_chats: 'plan', get_session: 'plan', get_sessions_status: 'plan', list_projects: 'plan',
  send_inbox: 'plan', run_dynamic_workflow: 'plan', dynamic_workflows_manage: 'plan', render_widget: 'plan',
  discover_widgets: 'plan', clear_widget: 'plan', save_workflow: 'plan', save_session_automation: 'plan',
  navigate_to: 'plan', fork_session: 'plan', open_pr_session: 'plan', open_issue_session: 'plan',
  // read
  view: 'read', read: 'read', read_file: 'read', readfile: 'read', open_file: 'read', cat: 'read',
  list_dir: 'read', ls: 'read', get_changes_overview: 'read', get_errors: 'read', query_library: 'read',
  // search
  grep: 'search', rg: 'search', glob: 'search', find: 'search', search: 'search', file_search: 'search',
  lexical_code_search: 'search', semantic_code_search: 'search', grep_search: 'search',
  codebase_search: 'search', semantic_search: 'search', find_references: 'search', lsp: 'search',
  go_to_definition: 'search', list_code_usages: 'search',
  // code
  edit: 'code', create: 'code', apply_patch: 'code', write: 'code', write_file: 'code', str_replace: 'code',
  str_replace_editor: 'code', str_replace_based_edit_tool: 'code', insert: 'code', multi_edit: 'code',
  multiedit: 'code', replace_string_in_file: 'code', multi_replace_string_in_file: 'code',
  create_file: 'code', edit_file: 'code', notebook_edit: 'code', edit_notebook_file: 'code',
  // shell (refined by classifyShell)
  powershell: 'shell', bash: 'shell', shell: 'shell', local_shell: 'shell', run_in_terminal: 'shell',
  terminal: 'shell', exec: 'shell', read_powershell: 'shell', write_powershell: 'shell',
  stop_powershell: 'shell', list_powershell: 'shell', read_bash: 'shell', write_bash: 'shell',
  stop_bash: 'shell', list_bash: 'shell', get_terminal_output: 'shell',
  // research
  web_fetch: 'research', web_search: 'research', fetch: 'research', fetch_webpage: 'research',
  fetch_copilot_cli_documentation: 'research', http_request: 'research',
  // ship
  create_pull_request: 'ship', update_pull_request: 'ship', merge_pull_request: 'ship',
  task_complete: 'ship', create_issue: 'ship', reply_to_comment: 'ship', reply_to_review_thread: 'ship',
  reply_and_resolve_review_thread: 'ship', manage_agent_merge: 'ship', add_pr_review_comment: 'ship',
  // ask
  ask_user: 'ask', request_user_input: 'ask',
  // taste-testing: visual checks in canvases / browsers
  open_canvas: 'test', invoke_canvas_action: 'test', list_canvas_capabilities: 'test',
  // trash
  delete_item: 'trash', delete_file: 'trash', archive_session: 'trash',
};

const SHELL_TOOLS = new Set(['powershell', 'bash', 'shell', 'local_shell', 'run_in_terminal', 'terminal', 'exec']);
const SHELL_FOLLOWUP_TOOLS = new Set(['read_powershell', 'write_powershell', 'stop_powershell',
  'read_bash', 'write_bash', 'stop_bash', 'get_terminal_output']);

export function isShellTool(name) {
  return SHELL_TOOLS.has(name);
}

export function isShellFollowupTool(name) {
  return SHELL_FOLLOWUP_TOOLS.has(name);
}

// ---------------------------------------------------------------------------
// Shell command classification
// ---------------------------------------------------------------------------

const RE = {
  test: /^(test|tests|e2e|spec|specs|unit|integration|cypress|playwright|vitest|jest|mocha|check:test|coverage)([:_-].*)?$/,
  build: /^(build|compile|bundle|typecheck|type-check|tsc|pack|package|dist)([:_-].*)?$/,
  lint: /^(lint|format|fmt|prettier|eslint|stylelint|style|check)([:_-].*)?$/,
  serve: /^(start|dev|serve|preview|watch)([:_-].*)?$/,
  ship: /^(deploy|release|publish|ship)([:_-].*)?$/,
  install: /^(install|setup|bootstrap|restore|deps)([:_-].*)?$/,
  clean: /^(clean|clobber|purge)([:_-].*)?$/,
};

const TEST_RUNNERS = new Set(['pytest', 'tox', 'nox', 'nose2', 'jest', 'vitest', 'mocha', 'ava', 'tap', 'karma',
  'cypress', 'rspec', 'phpunit', 'ctest', 'invoke-pester', 'pester', 'xunit', 'nunit3-console', 'vstest.console',
  'behave', 'cucumber', 'jasmine', 'bats']);
const BUILDERS = new Set(['tsc', 'esbuild', 'webpack', 'rollup', 'parcel', 'swc', 'babel', 'msbuild', 'cmake',
  'ninja', 'ant', 'javac', 'gcc', 'g++', 'clang', 'clang++', 'cl', 'rustc', 'xcodebuild', 'next', 'nuxt', 'ng',
  'vite', 'tsup', 'turbopack', 'scons', 'meson', 'premake', 'devenv']);
const LINTERS = new Set(['eslint', 'prettier', 'stylelint', 'biome', 'ruff', 'black', 'isort', 'flake8', 'pylint',
  'mypy', 'pyright', 'gofmt', 'goimports', 'golangci-lint', 'rustfmt', 'rubocop', 'shellcheck', 'markdownlint',
  'markdownlint-cli2', 'clang-format', 'clang-tidy', 'swiftlint', 'swiftformat', 'ktlint', 'invoke-scriptanalyzer',
  'oxlint', 'dprint', 'standard', 'tslint', 'hadolint', 'actionlint', 'yamllint', 'cspell']);
const INSTALLERS = new Set(['pip', 'pip3', 'pipx', 'conda', 'mamba', 'bundle', 'gem', 'composer', 'brew', 'winget',
  'choco', 'scoop', 'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'apk', 'install-module', 'install-package',
  'install-psresource', 'vcpkg', 'conan', 'nvm', 'fnm', 'volta', 'rustup', 'sdk', 'asdf', 'mise']);
const READERS = new Set(['cat', 'type', 'get-content', 'gc', 'head', 'tail', 'less', 'more', 'bat', 'wc', 'ls',
  'dir', 'get-childitem', 'gci', 'tree', 'pwd', 'stat', 'get-item', 'test-path', 'file', 'du', 'resolve-path',
  'get-location', 'nl', 'od', 'xxd', 'hexdump', 'format-hex', 'get-filehash', 'jq', 'yq', 'diff', 'fc',
  'compare-object', 'get-process', 'ps', 'tasklist', 'env', 'printenv', 'get-command', 'whoami', 'hostname',
  'uname', 'ver', 'systeminfo', 'df', 'free', 'top', 'netstat', 'get-nettcpconnection', 'lsof']);
const SEARCHERS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'find', 'fd', 'select-string', 'sls',
  'findstr', 'where', 'where.exe', 'which', 'locate', 'git-grep']);
const FETCHERS = new Set(['curl', 'wget', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'http', 'https',
  'httpie', 'xh', 'nslookup', 'dig', 'ping', 'test-netconnection', 'ssh', 'scp', 'rsync']);
const DELETERS = new Set(['rm', 'del', 'erase', 'rmdir', 'rd', 'remove-item', 'ri', 'unlink', 'shred', 'trash']);
const PREFIXES = new Set(['sudo', 'time', 'nohup', 'exec', 'command', 'builtin', 'call', 'start-process', '&', '.',
  'env', 'cross-env', 'dotenv', 'npx', 'pnpx', 'bunx', 'uvx', 'pipx', 'stdbuf', 'unbuffer', 'timeout',
  'measure-command', 'invoke-expression', 'iex', 'cmd', 'cmd.exe', '/c', 'pwsh', 'powershell', '-command',
  '-c', '-noprofile', '-nologo', 'bash', 'sh', 'zsh']);

/** Split a shell command into simple segments (`a && b; c | d`). Quotes are not parsed; that's fine here. */
export function splitShellSegments(command) {
  return String(command || '')
    .split(/\r?\n|&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokenize(segment) {
  return segment.split(/\s+/).map((t) => t.replace(/^['"(]+|['")]+$/g, '')).filter(Boolean);
}

function baseCommand(token) {
  const t = token.toLowerCase().replace(/\\/g, '/');
  const base = t.slice(t.lastIndexOf('/') + 1);
  return base.replace(/\.(exe|cmd|bat|ps1|sh|bash|py|js|mjs|cjs|ts)$/, '');
}

function isScriptPath(token) {
  return /[\\/]/.test(token) || /\.(ps1|sh|bash|cmd|bat|py|js|mjs|cjs|ts)$/i.test(token);
}

function byName(name) {
  const n = name.toLowerCase();
  if (RE.test.test(n)) return 'test';
  if (RE.build.test(n)) return 'build';
  if (RE.lint.test(n)) return 'lint';
  if (RE.ship.test(n)) return 'ship';
  if (RE.install.test(n)) return 'install';
  if (RE.clean.test(n)) return 'trash';
  return null;
}

function firstNonFlag(tokens, start = 1, skipValueFlags = []) {
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i];
    if (skipValueFlags.includes(t)) { i++; continue; }
    if (t.startsWith('-')) continue;
    return { value: t.toLowerCase(), index: i };
  }
  return { value: '', index: tokens.length };
}

function classifyGit(tokens) {
  const { value: sub, index } = firstNonFlag(tokens, 1, ['-C', '-c', '--git-dir', '--work-tree']);
  const rest = tokens.slice(index + 1);
  switch (sub) {
    case 'push': return 'ship';
    case 'commit': case 'add': case 'merge': case 'rebase': case 'cherry-pick': case 'stash': case 'tag':
    case 'am': case 'revert': case 'mv': return 'commit';
    case 'reset': case 'clean': case 'restore': case 'rm': return 'trash';
    case 'checkout': return rest.includes('--') ? 'trash' : 'shell';
    case 'fetch': case 'pull': case 'clone': case 'submodule': case 'ls-remote': return 'research';
    case 'grep': return 'search';
    case 'status': case 'diff': case 'log': case 'show': case 'blame': case 'branch': case 'ls-files':
    case 'rev-parse': case 'describe': case 'shortlog': case 'remote': case 'config': case 'reflog':
    case 'ls-tree': case 'cat-file': case 'rev-list': case 'whatchanged': case 'name-rev': case 'merge-base':
      return 'read';
    default: return 'shell';
  }
}

function classifyGh(tokens) {
  const { value: area, index } = firstNonFlag(tokens, 1, ['-R', '--repo']);
  const { value: action } = firstNonFlag(tokens, index + 1, ['-R', '--repo']);
  const writes = /^(create|merge|ready|edit|comment|review|close|reopen|delete|upload|run|rerun|cancel|enable|disable|lock|transfer)$/;
  if (area === 'pr' || area === 'issue') {
    if (action === 'checkout') return 'shell';
    return writes.test(action) ? 'ship' : 'research';
  }
  if (area === 'release' || area === 'workflow') return writes.test(action) ? 'ship' : 'research';
  if (area === 'run') return action === 'rerun' || action === 'cancel' ? 'shell' : 'research';
  if (area === 'auth' || area === 'config' || area === 'extension' || area === 'alias') return 'shell';
  return 'research'; // api, search, repo, browse, gist, codespace...
}

function classifyPackageManager(tool, tokens) {
  const { value: sub, index } = firstNonFlag(tokens, 1, ['--prefix', '-C', '--filter', '-w', '--workspace', '--cwd']);
  if (!sub) return tool === 'yarn' ? 'install' : 'shell';
  if (/^(install|i|ci|add|update|up|upgrade|remove|uninstall|rm|dedupe|prune|link|rebuild)$/.test(sub)) return 'install';
  if (sub === 'test' || sub === 't' || sub === 'tst') return 'test';
  if (sub === 'publish') return 'ship';
  if (sub === 'pack') return 'build';
  if (/^(exec|x|dlx)$/.test(sub)) return classifySegmentTokens(tokens.slice(index + 1));
  const script = sub === 'run' || sub === 'run-script' ? (firstNonFlag(tokens, index + 1).value || '') : sub;
  if (RE.serve.test(script)) return 'shell';
  return byName(script) || 'shell';
}

function classifyByTarget(tokens, fallback) {
  for (const t of tokens.slice(1)) {
    if (t.startsWith('-')) continue;
    const c = byName(t.replace(/^:/, '').split(':').pop());
    if (c) return c;
  }
  return fallback;
}

function classifySegmentTokens(tokens) {
  // Strip prefixes such as `sudo`, `npx -y`, `& "C:\path\tool.exe"`, env assignments.
  let i = 0;
  // PowerShell assignment: `$out = npm test`
  if (tokens.length > 2 && tokens[0].startsWith('$') && tokens[1] === '=') i = 2;
  while (i < tokens.length) {
    const t = tokens[i].toLowerCase();
    if (PREFIXES.has(t) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || /^\$env:/i.test(tokens[i])) { i++; continue; }
    if ((t === '-y' || t === '--yes' || t === '-p' || t === '--package') && i > 0) { i += t === '-p' || t === '--package' ? 2 : 1; continue; }
    if (t.startsWith('-') && i > 0 && PREFIXES.has(tokens[i - 1].toLowerCase())) { i++; continue; }
    break;
  }
  tokens = tokens.slice(i);
  if (!tokens.length) return 'shell';
  const raw = tokens[0];
  const cmd = baseCommand(raw);
  const sub = firstNonFlag(tokens).value;

  switch (cmd) {
    case 'git': return classifyGit(tokens);
    case 'gh': return classifyGh(tokens);
    case 'npm': case 'pnpm': case 'yarn': case 'bun': return classifyPackageManager(cmd, tokens);
    case 'node': case 'deno': case 'tsx': case 'ts-node': {
      if (tokens.includes('--test') || sub === 'test') return 'test';
      if (cmd === 'deno' && /^(fmt|lint)$/.test(sub)) return 'lint';
      if (cmd === 'deno' && /^(compile|bundle)$/.test(sub)) return 'build';
      return sub ? byName(baseCommand(sub)) || 'shell' : 'shell';
    }
    case 'python': case 'python3': case 'py': {
      const m = tokens.indexOf('-m');
      if (m >= 0 && tokens[m + 1]) {
        const mod = tokens[m + 1].toLowerCase();
        if (/^(pytest|unittest|tox|nose2?|behave)$/.test(mod)) return 'test';
        if (mod === 'pip') return 'install';
        if (LINTERS.has(mod)) return 'lint';
        if (mod === 'build') return 'build';
        if (mod === 'http.server') return 'shell';
      }
      if (tokens.slice(2).some((t) => t.toLowerCase() === 'test')) return 'test'; // e.g. python manage.py test
      return sub ? byName(baseCommand(sub)) || 'shell' : 'shell';
    }
    case 'uv': case 'poetry': case 'pdm': case 'hatch': case 'rye': {
      if (/^(sync|add|remove|lock|install|update|pip)$/.test(sub)) return 'install';
      if (sub === 'build') return 'build';
      if (sub === 'publish') return 'ship';
      if (sub === 'run') return classifySegmentTokens(tokens.slice(tokens.findIndex((t) => t.toLowerCase() === 'run') + 1));
      return byName(sub) || 'shell';
    }
    case 'cargo': {
      if (/^(test|nextest|bench)$/.test(sub)) return 'test';
      if (/^(build|check|doc)$/.test(sub)) return 'build';
      if (/^(clippy|fmt)$/.test(sub)) return 'lint';
      if (/^(add|fetch|install|update|remove|vendor)$/.test(sub)) return 'install';
      if (sub === 'publish') return 'ship';
      if (sub === 'clean') return 'trash';
      return 'shell';
    }
    case 'go': {
      if (sub === 'test') return 'test';
      if (/^(build|install|generate)$/.test(sub)) return 'build';
      if (/^(vet|fmt)$/.test(sub)) return 'lint';
      if (/^(mod|get)$/.test(sub)) return 'install';
      if (sub === 'clean') return 'trash';
      return 'shell';
    }
    case 'dotnet': {
      if (/^(test|vstest)$/.test(sub)) return 'test';
      if (/^(build|publish|pack|msbuild)$/.test(sub)) return 'build';
      if (/^(restore|add|tool|workload)$/.test(sub)) return 'install';
      if (sub === 'format') return 'lint';
      if (sub === 'nuget') return tokens.some((t) => t.toLowerCase() === 'push') ? 'ship' : 'install';
      if (sub === 'clean') return 'trash';
      return 'shell';
    }
    case 'make': case 'gmake': case 'nmake': case 'just': case 'task': case 'rake': case 'invoke': case 'mage':
      return classifyByTarget(tokens, cmd === 'make' || cmd === 'gmake' || cmd === 'nmake' ? 'build' : 'shell');
    case 'gradle': case 'gradlew': {
      const c = classifyByTarget(tokens, 'build');
      return tokens.slice(1).some((t) => /^(test|check|connectedcheck)$/i.test(t.split(':').pop())) ? 'test' : c;
    }
    case 'mvn': case 'mvnw': {
      const goals = tokens.slice(1).filter((t) => !t.startsWith('-')).map((t) => t.toLowerCase());
      if (goals.includes('deploy')) return 'ship';
      if (goals.some((g) => g === 'test' || g === 'verify' || g === 'integration-test')) return 'test';
      return 'build';
    }
    case 'bazel': case 'bazelisk': case 'buck2': case 'pants':
      return sub === 'test' ? 'test' : sub === 'build' ? 'build' : 'shell';
    case 'nx': case 'turbo': case 'lerna': case 'rush':
      return classifyByTarget(tokens, 'shell');
    case 'docker': case 'podman': case 'nerdctl': {
      const s = sub === 'compose' || sub === 'buildx' ? firstNonFlag(tokens, tokens.findIndex((t) => t.toLowerCase() === sub) + 1).value : sub;
      if (s === 'build' || s === 'bake') return 'build';
      if (s === 'push') return 'ship';
      if (s === 'pull') return 'install';
      if (s === 'rm' || s === 'rmi' || s === 'prune' || s === 'down') return 'trash';
      return 'shell';
    }
    case 'kubectl': case 'oc':
      return /^(apply|create|rollout|replace|patch|set|scale)$/.test(sub) ? 'ship'
        : /^(delete)$/.test(sub) ? 'trash' : 'research';
    case 'helm': return /^(install|upgrade|rollback)$/.test(sub) ? 'ship' : 'research';
    case 'terraform': case 'tofu': case 'pulumi':
      return /^(apply|up|deploy|import)$/.test(sub) ? 'ship' : sub === 'plan' || sub === 'preview' ? 'plan'
        : sub === 'init' ? 'install' : sub === 'destroy' ? 'trash' : sub === 'fmt' || sub === 'validate' ? 'lint' : 'shell';
    case 'az': case 'aws': case 'gcloud': case 'azd':
      return tokens.slice(1).some((t) => /^(deploy|up|create|publish|sync|apply)$/i.test(t)) ? 'ship' : 'research';
    case 'vercel': case 'netlify': case 'fly': case 'flyctl': case 'firebase': case 'wrangler': case 'heroku':
      return tokens.slice(1).some((t) => /^(deploy|publish|--prod)$/i.test(t)) || cmd === 'vercel' ? 'ship' : 'shell';
    case 'playwright':
      return sub === 'install' ? 'install' : sub === 'test' ? 'test' : 'shell';
    case 'vite':
      return sub === 'build' ? 'build' : 'shell';
    case 'nuget':
      return sub === 'push' ? 'ship' : 'install';
    case 'cmake':
      return tokens.includes('--build') || tokens.includes('-B') || !sub ? 'build' : 'build';
    case 'ctest': return 'test';
    default:
      break;
  }

  if (TEST_RUNNERS.has(cmd)) return 'test';
  if (LINTERS.has(cmd)) return 'lint';
  if (BUILDERS.has(cmd)) return 'build';
  if (INSTALLERS.has(cmd)) {
    if (cmd === 'pip' || cmd === 'pip3') return /^(install|download|uninstall|sync)$/.test(sub) ? 'install' : 'read';
    return 'install';
  }
  if (DELETERS.has(cmd)) return 'trash';
  if (SEARCHERS.has(cmd)) return 'search';
  if (FETCHERS.has(cmd)) return 'research';
  if (READERS.has(cmd)) return 'read';
  if (isScriptPath(raw)) return byName(cmd) || 'shell';
  return 'shell';
}

/** Classify one shell command (optionally with the tool's human description) into a station id. */
export function classifyShell(command, description = '') {
  let best = 'shell';
  for (const seg of splitShellSegments(command)) {
    const c = classifySegmentTokens(tokenize(seg));
    if ((SHELL_PRIORITY[c] ?? 0) > (SHELL_PRIORITY[best] ?? 0)) best = c;
  }
  if (best === 'shell' && description) {
    const d = description.toLowerCase();
    if (/\b(run|running|execute)\b.*\btests?\b|\btest suite\b|\bunit tests?\b|^tests?\b/.test(d)) best = 'test';
    else if (/\b(build|compile|bundle)\b/.test(d)) best = 'build';
    else if (/\b(lint|format)\b/.test(d)) best = 'lint';
    else if (/\binstall\b|\brestore\b.*\b(dependencies|packages)\b/.test(d)) best = 'install';
    else if (/\bcommit\b/.test(d)) best = 'commit';
    else if (/\b(push|deploy|publish|open (a )?pr|pull request)\b/.test(d)) best = 'ship';
  }
  return best;
}

// ---------------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------------

function str(v) {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export function truncate(text, max) {
  const s = str(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…` : s;
}

export function shortPath(p) {
  const parts = str(p).replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length) return '';
  return parts.slice(-2).join('/');
}

function hostOf(url) {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(str(url));
  return m ? m[1].replace(/^www\./, '') : truncate(url, 30);
}

/** Parse the file operations out of an apply_patch payload. */
export function patchFiles(args) {
  const text = typeof args === 'string' ? args : str(args?.patch ?? args?.input ?? args?.content ?? '');
  const files = [];
  const re = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;
  let m;
  while ((m = re.exec(text))) files.push({ op: m[1].toLowerCase(), path: m[2].trim() });
  return files;
}

function mcpParts(name) {
  // e.g. "github-mcp-server-get_file_contents", "slack-slack_search_public", "workiq-ask"
  const m = /^(.*?)-([A-Za-z0-9_]+)$/.exec(name);
  if (!m) return null;
  return { server: m[1].replace(/-mcp-server$|-mcp$/i, ''), tool: m[2] };
}

function humanize(name) {
  return str(name).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Classify a tool invocation.
 * @returns {{ station: string, label: string }}
 */
export function classifyTool(toolName, args = {}) {
  const name = str(toolName);
  const lower = name.toLowerCase();
  const a = args && typeof args === 'object' ? args : {};

  if (isShellTool(lower)) {
    const command = str(a.command ?? a.cmd ?? a.script ?? (typeof args === 'string' ? args : ''));
    const station = classifyShell(command, str(a.description));
    const label = a.description ? truncate(a.description, 48) : truncate(splitShellSegments(command)[0] || name, 48);
    return { station, label };
  }

  if (lower === 'apply_patch') {
    const files = patchFiles(args);
    if (files.length && files.every((f) => f.op === 'delete')) {
      return { station: 'trash', label: `Binning ${files.map((f) => shortPath(f.path)).slice(0, 2).join(', ')}` };
    }
    const names = files.map((f) => shortPath(f.path).split('/').pop());
    return { station: 'code', label: names.length ? `Patching ${truncate(names.slice(0, 3).join(', '), 40)}` : 'Patching code' };
  }

  let station = TOOL_MAP[lower];
  if (!station) {
    if (/^computer-use-|playwright|_browser_|browser_batch|javascript_tool|preview_start|^browser[_-]|screenshot/.test(lower)) station = 'test';
    else {
      const mcp = mcpParts(name);
      if (mcp) {
        const t = mcp.tool.toLowerCase();
        if (/(create_pull_request|merge_pull_request|push_files|create_or_update_file|create_issue|update_issue|add_.*comment|send_|post_|create_branch)/.test(t)) station = 'ship';
        else if (/^(delete|remove)_/.test(t)) station = 'trash';
        else if (/(search_code|code_search)/.test(t)) station = 'search';
        else station = 'research';
      } else {
        station = 'shell';
      }
    }
  }

  return { station, label: toolLabel(name, lower, a, station) };
}

function toolLabel(name, lower, a, station) {
  switch (lower) {
    case 'view': case 'read': case 'read_file': case 'readfile': case 'open_file': case 'cat':
      return `Reading ${shortPath(a.path ?? a.filePath ?? a.file_path ?? a.file) || 'a file'}`;
    case 'list_dir': case 'ls':
      return `Browsing ${shortPath(a.path) || 'a folder'}`;
    case 'grep': case 'rg': case 'grep_search': case 'search':
      return `Searching “${truncate(a.pattern ?? a.query ?? '', 26)}”`;
    case 'glob': case 'file_search': case 'find':
      return `Finding ${truncate(a.pattern ?? a.query ?? 'files', 30)}`;
    case 'lexical_code_search': case 'semantic_code_search': case 'codebase_search': case 'semantic_search':
      return `Searching for ${truncate(a.query ?? a.pattern ?? 'code', 30)}`;
    case 'edit': case 'str_replace': case 'str_replace_editor': case 'str_replace_based_edit_tool':
    case 'replace_string_in_file': case 'multi_edit': case 'multiedit': case 'edit_file': case 'insert':
      return `Chopping ${shortPath(a.path ?? a.filePath ?? a.file_path).split('/').pop() || 'code'}`;
    case 'create': case 'create_file': case 'write': case 'write_file':
      return `Creating ${shortPath(a.path ?? a.filePath ?? a.file_path).split('/').pop() || 'a file'}`;
    case 'web_fetch': case 'fetch': case 'fetch_webpage':
      return `Fetching ${hostOf(a.url ?? (Array.isArray(a.urls) ? a.urls[0] : ''))}`;
    case 'web_search':
      return `Web search “${truncate(a.query ?? '', 26)}”`;
    case 'task':
      return `Briefing a sous-chef: ${truncate(a.description ?? a.name ?? a.agent_type ?? 'task', 32)}`;
    case 'read_agent': case 'write_agent': case 'list_agents':
      return 'Checking on sous-chefs';
    case 'ask_user': case 'request_user_input':
      return 'Asking you a question';
    case 'skill':
      return `Opening recipe “${truncate(a.skill ?? a.name ?? '', 24)}”`;
    case 'sql':
      return a.description ? truncate(a.description, 40) : /todo/i.test(str(a.query)) ? 'Updating the order list' : 'Checking the ledger';
    case 'store_memory': case 'vote_memory':
      return 'Writing in the recipe book';
    case 'read_memories':
      return 'Reading the recipe book';
    case 'report_intent':
      return truncate(a.intent ?? 'Planning', 40);
    case 'task_complete':
      return 'Serving the order!';
    case 'create_pull_request':
      return 'Sending out a pull request';
    case 'read_powershell': case 'read_bash': case 'get_terminal_output':
      return 'Checking the pot';
    case 'write_powershell': case 'write_bash':
      return 'Stirring the pot';
    case 'stop_powershell': case 'stop_bash':
      return 'Taking the pot off the heat';
    case 'open_canvas': case 'invoke_canvas_action':
      return 'Taste-testing in a canvas';
    default: {
      if (lower.startsWith('computer-use-')) return `Taste-testing the UI (${humanize(name.slice(13))})`;
      const mcp = mcpParts(name);
      if (mcp && station !== 'shell') return `${humanize(mcp.server)}: ${humanize(mcp.tool)}`;
      return humanize(name) || 'Working';
    }
  }
}
