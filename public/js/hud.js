import { STATION_BY_ID } from '../shared/stations.js';
import { iconSvg, stationIconSvg, dishFor } from './icons.js';
import { escapeHtml, chefName } from './overlay.js';

export const fmtDur = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d`;
  return h ? `${h}h${String(m % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};

/** How long an order can cook before its ticket timer runs out (it just turns red and shakes). */
const PATIENCE_MS = 10 * 60 * 1000;
const MAX_TICKETS = 6;

const GEAR = '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#5d4037" d="M10.3 2h3.4l.5 2.6 1.7.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.7 2.6.5v3.4l-2.6.5-.8 1.7 1.5 2.2-2.4 2.4-2.2-1.5-1.7.8-.5 2.6h-3.4l-.5-2.6-1.7-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.7L2 13.7v-3.4l2.6-.5.8-1.7-1.5-2.2 2.4-2.4 2.2 1.5 1.7-.8z"/><circle cx="12" cy="12" r="3.4" fill="#fff8ea"/></svg>';

const TEMPLATE = `
  <div class="orders" aria-label="Order tickets"></div>
  <div class="brand">
    <div class="logo" title="An Overcooked-inspired live view of your Claude Code agents"><span class="logo-a">AGENT</span><span class="logo-b">KITCHEN</span></div>
    <div class="conn"><i class="dot"></i><span class="conn-text">Connecting…</span></div>
    <div class="toolbar">
      <button class="btn" data-act="legend" title="What do the stations mean?">${iconSvg('book', 18)}<span>Menu</span></button>
      <button class="btn" data-act="roster" title="All chefs (sessions)">${iconSvg('hat', 18)}<span>Brigade</span></button>
      <button class="btn" data-act="settings" title="Settings">${GEAR}<span>Settings</span></button>
    </div>
  </div>
  <div class="coins" title="Coins: 20 per served order plus a speed tip">
    <div class="coin-icon">${iconSvg('coin', 74)}</div>
    <div class="coin-body"><div class="coin-count">0</div><div class="coin-sub"></div></div>
  </div>
  <div class="clock">
    <svg class="clock-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" cx="50" cy="50" r="44"/></svg>
    <div class="clock-face"><div class="clock-time">--:--</div><div class="clock-label">LIVE</div></div>
  </div>
  <div class="ticker" aria-live="polite"></div>
  <aside class="roster"></aside>
  <div class="modal legend hidden" role="dialog" aria-label="Menu"></div>
  <div class="popover settings hidden" role="dialog" aria-label="Settings"></div>
  <div class="empty hidden"></div>
  <div class="banner"></div>
`;

export class Hud {
  constructor(root, { store, director, overlay, settings, mode }) {
    this.root = root;
    this.store = store;
    this.director = director;
    this.overlay = overlay;
    this.settings = settings;
    this.mode = mode;
    root.innerHTML = TEMPLATE;
    const q = (s) => root.querySelector(s);
    this.ordersEl = q('.orders');
    this.coinCount = q('.coin-count');
    this.coinSub = q('.coin-sub');
    this.coinIcon = q('.coin-icon');
    this.clockTime = q('.clock-time');
    this.clockLabel = q('.clock-label');
    this.clockFg = q('.clock-ring .fg');
    this.connEl = q('.conn');
    this.connText = q('.conn-text');
    this.tickerEl = q('.ticker');
    this.emptyEl = q('.empty');
    this.bannerEl = q('.banner');
    this.tickets = new Map();
    this.coins = { shown: 0, target: 0 };
    this.sessions = [];
    store.on('sessions', (list) => this.renderSessions(list));
    store.on('totals', (t) => this.renderTotals(t));
    store.on('fx', (f) => this.onFx(f));
    store.on('connection', (c) => this.renderConnection(c));
    director.on((type, data) => {
      if (type === 'serve' && data.prop) this.overlay.floater(data.prop.anchor, `${iconSvg('coin', 26)}<b>+${data.coins ?? 20}</b>`, 'coins-pop');
    });
    this.renderConnection(store.connection);
  }

  chefColor(sessionId) {
    return this.director.colorFor(sessionId);
  }

  privateText(text, fallback) {
    return this.settings.privacy ? fallback : text;
  }

  renderSessions(list) {
    this.sessions = list;
    const open = [];
    for (const s of list) {
      if (s.status === 'offline') continue; // a clocked-out chef's tickets leave with them
      for (const o of s.orders || []) open.push({ key: `${s.id}|${o.id}`, order: o, session: s });
    }
    open.sort((a, b) => a.order.startedAt - b.order.startedAt);
    const shown = open.slice(-MAX_TICKETS);
    const keep = new Set(shown.map((x) => x.key));
    for (const [key, tk] of this.tickets) {
      if (keep.has(key) || tk.leaving) continue;
      tk.leaving = true;
      // The matching served/failed effect arrives right after this update; give it a tick to tag the outcome.
      setTimeout(() => {
        if (!tk.node.dataset.outcome) tk.node.classList.add('vanish');
        setTimeout(() => {
          tk.node.remove();
          this.tickets.delete(key);
        }, 900);
      }, 0);
    }
    for (const item of shown) {
      let tk = this.tickets.get(item.key);
      if (!tk) {
        const node = document.createElement('div');
        node.className = 'ticket enter';
        node.innerHTML = '<div class="ticket-timer"><div class="fill"></div></div><div class="ticket-head"><span class="dish"></span><div class="ticket-title"><div class="dish-name"></div><div class="ticket-chef"><i></i><span></span></div></div><span class="elapsed"></span></div><div class="ticket-prompt"></div><div class="ticket-ings"></div>';
        this.ordersEl.appendChild(node);
        setTimeout(() => node.classList.remove('enter'), 600);
        tk = { node, fill: node.querySelector('.fill'), elapsed: node.querySelector('.elapsed'), last: {} };
        this.tickets.set(item.key, tk);
      }
      tk.order = item.order;
      tk.session = item.session;
      this.fillTicket(tk);
    }
    const overflow = open.length - shown.length;
    let more = this.ordersEl.querySelector('.more');
    if (overflow > 0) {
      if (!more) {
        more = document.createElement('div');
        more.className = 'more';
        this.ordersEl.prepend(more);
      }
      more.textContent = `+${overflow}`;
    } else if (more) more.remove();

    const active = list.filter((s) => s.status !== 'offline').length;
    this.connText.textContent = this.connLabel(active);
    this.renderEmpty(active);
  }

  fillTicket(tk) {
    const { order, session, node } = tk;
    const dish = dishFor(order.stations);
    const color = this.chefColor(session.id);
    const prompt = order.implicit ? 'Follow-up' : this.privateText(order.text, 'Order details hidden');
    const title = chefName(session, this.settings);
    const sig = [dish.name, color, title, prompt, order.stations.join(','), order.toolCount, this.settings.privacy].join('|');
    if (tk.last.sig === sig) return;
    tk.last.sig = sig;
    node.style.setProperty('--chef', color);
    node.querySelector('.dish').innerHTML = iconSvg(dish.icon, 36);
    node.querySelector('.dish-name').textContent = dish.name;
    node.querySelector('.ticket-chef span').textContent = title;
    const p = node.querySelector('.ticket-prompt');
    p.textContent = prompt;
    p.classList.toggle('muted', order.implicit || this.settings.privacy);
    p.title = this.settings.privacy ? '' : order.text;
    const ings = order.stations.slice(-5)
      .map((s) => `<span class="ing" title="${escapeHtml(STATION_BY_ID[s]?.sdlc || s)}">${stationIconSvg(s, 18)}</span>`).join('') || '<span class="ing empty">…</span>';
    node.querySelector('.ticket-ings').innerHTML = `${ings}<span class="steps">${order.toolCount}</span>`;
    node.querySelector('.ticket-ings .steps').title = `${order.toolCount} step${order.toolCount === 1 ? '' : 's'} so far`;
  }

  renderTotals(t) {
    this.coins.target = t.coins;
    this.coinSub.textContent = `${t.served} served · ${t.fires} fire${t.fires === 1 ? '' : 's'}`;
  }

  connLabel(active) {
    const n = `${active} chef${active === 1 ? '' : 's'}`;
    switch (this.store.connection) {
      case 'live': return `Live · ${n}`;
      case 'demo': return `Demo shift · ${n}`;
      case 'reconnecting': return 'Reconnecting…';
      case 'offline': return 'Server offline';
      default: return 'Connecting…';
    }
  }

  renderConnection(c) {
    this.connEl.dataset.state = c;
    this.connText.textContent = this.connLabel(this.sessions.filter((s) => s.status !== 'offline').length);
    this.clockLabel.textContent = c === 'demo' ? 'DEMO' : c === 'live' ? 'LIVE' : c === 'reconnecting' ? 'WAIT' : 'OFF';
    this.renderEmpty(this.sessions.filter((s) => s.status !== 'offline').length);
    if (c === 'reconnecting') this.banner('Reconnecting…', 'warn', 1800);
  }

  renderEmpty(active) {
    const c = this.store.connection;
    let html = '';
    if (c === 'offline') {
      html = `<div class="card"><h2>Can’t reach the kitchen</h2><p>Start the server with <code>npm start</code> (it watches <code>~/.claude/projects</code>), then reload.</p><a class="btn big" href="?demo">${iconSvg('hat', 22)}<span>Watch a demo shift</span></a></div>`;
    } else if (c === 'live' && active === 0) {
      html = `<div class="card"><h2>The kitchen is quiet</h2><p>No Claude Code sessions are cooking right now. Start one in a terminal, the desktop app or the SDK and a chef will clock in.</p><a class="btn big" href="?demo">${iconSvg('hat', 22)}<span>Watch a demo shift</span></a></div>`;
    }
    if (this.emptyEl.dataset.html !== html) {
      this.emptyEl.innerHTML = html;
      this.emptyEl.dataset.html = html;
    }
    this.emptyEl.classList.toggle('hidden', !html);
  }

  onFx(f) {
    const session = this.store.sessions.get(f.sessionId);
    const name = chefName(session, this.settings);
    const color = this.chefColor(f.sessionId);
    if (f.kind === 'served' || f.kind === 'failed') {
      const tk = this.tickets.get(`${f.sessionId}|${f.orderId}`);
      if (tk) {
        tk.node.dataset.outcome = f.kind;
        tk.node.classList.add(f.kind);
      }
      if (f.kind === 'served') {
        this.coinIcon.classList.remove('bump');
        void this.coinIcon.offsetWidth;
        this.coinIcon.classList.add('bump');
        this.tick(color, 'ship', `${name} served an order${f.tip ? ` · tip +${f.tip}` : ''}`, 'good');
      } else {
        this.tick(color, 'trash', `${name}’s order was cancelled`, 'bad');
      }
    } else if (f.kind === 'tool' && !f.agentId) {
      const info = STATION_BY_ID[f.station];
      this.tick(color, f.station, `${name}: ${this.settings.privacy ? `${info?.verb || 'Working'} (${info?.sdlc || f.station})` : f.label}`);
    } else if (f.kind === 'fire' && f.severity === 'fire') {
      this.tick(color, f.station, `${name}: fire at the ${STATION_BY_ID[f.station]?.kitchen || 'station'}! ${this.settings.privacy ? '' : f.message || ''}`, 'bad');
      this.banner('FIRE!', 'fire', 1300);
    } else if (f.kind === 'sub-start') {
      this.tick(color, 'plan', `${name} called in a sous-chef${this.settings.privacy ? '' : `: ${f.displayName || f.name}`}`);
    } else if (f.kind === 'order' && !f.implicit) {
      this.tick(color, 'ask', `New order for ${name}`, 'order');
    }
  }

  tick(color, station, text, cls = '') {
    const row = document.createElement('div');
    row.className = `tick ${cls}`;
    row.style.setProperty('--chef', color);
    row.innerHTML = `<i></i>${stationIconSvg(station, 18)}<span>${escapeHtml(text)}</span>`;
    this.tickerEl.prepend(row);
    while (this.tickerEl.children.length > 4) this.tickerEl.lastChild.remove();
    setTimeout(() => row.classList.add('fade'), 7000);
    setTimeout(() => row.remove(), 8000);
  }

  banner(text, cls = '', ms = 1500) {
    const b = this.bannerEl;
    b.textContent = text;
    b.className = `banner show ${cls}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (b.className = 'banner'), ms);
  }

  /** "Ready? … Go!" like the start of a level. */
  readyGo() {
    this.banner('Ready?', 'ready', 1100);
    setTimeout(() => this.banner('Go!', 'go', 900), 1150);
  }

  update() {
    const now = Date.now();
    // Count coins up smoothly.
    const c = this.coins;
    if (c.shown !== c.target) {
      c.shown += (c.target - c.shown) * 0.12;
      if (Math.abs(c.target - c.shown) < 0.5) c.shown = c.target;
      this.coinCount.textContent = String(Math.round(c.shown));
    }
    // Ticket patience bars.
    for (const tk of this.tickets.values()) {
      if (tk.leaving || !tk.order) continue;
      const el = now - tk.order.startedAt;
      const left = Math.max(0, 1 - el / PATIENCE_MS);
      tk.fill.style.width = `${(left * 100).toFixed(1)}%`;
      tk.fill.dataset.level = left > 0.5 ? 'ok' : left > 0.2 ? 'mid' : 'low';
      tk.node.classList.toggle('late', left === 0);
      tk.elapsed.textContent = fmtDur(el);
    }
    // Clock.
    const d = new Date();
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (this.clockTime.textContent !== hhmm) this.clockTime.textContent = hhmm;
    const circ = 2 * Math.PI * 44;
    this.clockFg.style.strokeDasharray = `${circ}`;
    this.clockFg.style.strokeDashoffset = `${circ * (1 - (d.getSeconds() + d.getMilliseconds() / 1000) / 60)}`;
  }
}
