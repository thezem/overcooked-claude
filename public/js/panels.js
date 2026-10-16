import { STATIONS, STATION_BY_ID } from '../shared/stations.js';
import { iconSvg, stationIconSvg } from './icons.js';
import { escapeHtml, chefName } from './overlay.js';
import { fmtDur } from './hud.js';

const STATUS_TEXT = { working: 'Cooking', thinking: 'Thinking', waiting: 'Needs you', idle: 'On break', offline: 'Clocked out' };

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** Brigade (roster), Menu (legend) and Settings panels. */
export class Panels {
  constructor(root, { store, director, settings, saveSettings, mode }) {
    this.root = root;
    this.store = store;
    this.director = director;
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.mode = mode;
    this.roster = root.querySelector('.roster');
    this.legend = root.querySelector('.legend');
    this.settingsEl = root.querySelector('.settings');
    this.renderLegend();
    this.renderSettings();
    root.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (btn) {
        const act = btn.dataset.act;
        if (act === 'legend') this.toggle(this.legend);
        else if (act === 'settings') this.toggle(this.settingsEl);
        else if (act === 'roster') this.setRoster(!this.roster.classList.contains('open'));
        return;
      }
      const card = ev.target.closest('.chef-card');
      if (card) {
        this.director.selected = this.director.selected === card.dataset.key ? null : card.dataset.key;
        this.renderRoster();
        return;
      }
      if (ev.target === this.legend) this.legend.classList.add('hidden');
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        this.legend.classList.add('hidden');
        this.settingsEl.classList.add('hidden');
        this.director.selected = null;
      } else if (ev.key === 'm' || ev.key === 'M') this.toggle(this.legend);
      else if (ev.key === 'b' || ev.key === 'B') this.setRoster(!this.roster.classList.contains('open'));
    });
    store.on('sessions', () => this.scheduleRoster());
    director.on(() => this.scheduleRoster());
    setInterval(() => this.renderRoster(), 1000);
    this.setRoster(settings.roster);
  }

  toggle(node) {
    const hidden = node.classList.contains('hidden');
    this.legend.classList.add('hidden');
    this.settingsEl.classList.add('hidden');
    node.classList.toggle('hidden', !hidden);
  }

  setRoster(open) {
    this.roster.classList.toggle('open', open);
    document.body.classList.toggle('roster-open', open);
    if (this.settings.roster !== open) {
      this.settings.roster = open;
      this.saveSettings();
    }
    this.renderRoster();
  }

  scheduleRoster() {
    if (this.rosterQueued) return;
    this.rosterQueued = true;
    requestAnimationFrame(() => {
      this.rosterQueued = false;
      this.renderRoster();
    });
  }

  activityText(e, session) {
    if (!e) return { station: null, text: STATUS_TEXT[session.status] || session.status };
    const a = this.director.activityOf(e);
    if (this.settings.privacy && a.station) {
      const info = STATION_BY_ID[a.station];
      return { station: a.station, text: a.thinking ? 'Thinking…' : `${info.verb} · ${info.sdlc}` };
    }
    return a;
  }

  renderRoster() {
    if (!this.roster.classList.contains('open')) return;
    const list = this.store.list();
    const on = list.filter((s) => s.status !== 'offline');
    const off = list.filter((s) => s.status === 'offline');
    const card = (s) => {
      const e = this.director.entities.get(s.id);
      const color = this.director.colorFor(s.id);
      const act = this.activityText(e, s);
      const selected = this.director.selected === s.id;
      const meta = this.settings.privacy ? s.repo || '' : [s.repo, s.branch].filter(Boolean).join(' · ') || s.cwd || '';
      const subs = (s.subagents || []).map((sa) => {
        const se = this.director.entities.get(`${s.id}:${sa.agentId}`);
        const sact = this.activityText(se, { status: 'working' });
        const sname = this.settings.privacy ? sa.name || 'Sous-chef' : sa.displayName || sa.name;
        return `<div class="sous-row">${iconSvg('hat', 16)}<b>${escapeHtml(sname)}</b><span>${sact.station ? stationIconSvg(sact.station, 14) : ''}${escapeHtml(sact.text)}</span></div>`;
      }).join('');
      let details = '';
      if (selected) {
        const orders = (s.orders || []).map((o) => `<li>${escapeHtml(o.implicit ? 'Follow-up' : this.settings.privacy ? 'Order details hidden' : o.text)} <small>${fmtDur(Date.now() - o.startedAt)}</small></li>`).join('');
        const recent = (s.recent || []).slice(-12).reverse().map((r) => {
          const label = this.settings.privacy ? STATION_BY_ID[r.station]?.sdlc || r.station : r.label;
          const ok = r.ok === false ? '<b class="bad">✗</b>' : r.ok === true ? '<b class="ok">✓</b>' : '<b class="run">…</b>';
          return `<li>${stationIconSvg(r.station, 16)}<span>${escapeHtml(label)}</span>${ok}<small>${ago(r.at)}</small></li>`;
        }).join('');
        details = `<div class="details">
          <div class="kv"><span>Model</span><b>${escapeHtml(s.model || '—')}</b></div>
          <div class="kv"><span>Mode</span><b>${escapeHtml(s.mode || 'interactive')}</b></div>
          <div class="kv"><span>Session</span><b>${escapeHtml(s.id.slice(0, 8))}</b></div>
          ${s.cwd && !this.settings.privacy ? `<div class="kv"><span>Folder</span><b title="${escapeHtml(s.cwd)}">${escapeHtml(s.cwd.split(/[\\/]/).slice(-2).join('/'))}</b></div>` : ''}
          <div class="kv"><span>Today</span><b>${s.stats.served} served · ${s.stats.tools} steps · ${s.stats.fires} fires</b></div>
          ${orders ? `<h4>Open orders</h4><ul class="orders-list">${orders}</ul>` : ''}
          ${recent ? `<h4>Recent steps</h4><ul class="recent">${recent}</ul>` : ''}
        </div>`;
      }
      return `<div class="chef-card ${selected ? 'selected' : ''} st-${s.status}" data-key="${escapeHtml(s.id)}" style="--chef:${color}">
        <div class="row">
          <div class="avatar">${iconSvg('hat', 30)}</div>
          <div class="info">
            <div class="name">${escapeHtml(chefName(s, this.settings))}${s.client ? `<span class="badge">${escapeHtml(s.client)}</span>` : ''}</div>
            <div class="meta">${escapeHtml(meta)}</div>
            <div class="doing">${act.station ? stationIconSvg(act.station, 16) : ''}<span>${escapeHtml(act.text)}</span></div>
          </div>
          <div class="pill ${s.status}">${STATUS_TEXT[s.status] || s.status}</div>
        </div>
        ${subs ? `<div class="sous">${subs}</div>` : ''}
        ${details}
      </div>`;
    };
    const html = `<header><h2>Brigade</h2><span class="count">${on.length} on shift</span><button class="x" data-act="roster" aria-label="Close">×</button></header>
      <div class="roster-list">${on.map(card).join('') || '<p class="none">No chefs on shift.</p>'}
      ${off.length ? `<h3>Clocked out</h3>${off.map(card).join('')}` : ''}</div>`;
    if (html !== this.lastRoster) {
      const scroll = this.roster.querySelector('.roster-list')?.scrollTop || 0;
      this.roster.innerHTML = html;
      const listEl = this.roster.querySelector('.roster-list');
      if (listEl) listEl.scrollTop = scroll;
      this.lastRoster = html;
    }
  }

  renderLegend() {
    const cards = STATIONS.map((s) => `<div class="menu-item st-${s.id}">
      <div class="menu-icon">${stationIconSvg(s.id, 40)}</div>
      <div><div class="menu-name">${escapeHtml(s.kitchen)} <span>→ ${escapeHtml(s.sdlc)}</span></div><div class="menu-ex">${escapeHtml(s.examples)}</div></div>
    </div>`).join('');
    this.legend.innerHTML = `<div class="card">
      <button class="x" data-act="legend" aria-label="Close">×</button>
      <h2>${iconSvg('book', 28)} The Menu</h2>
      <p class="lede">Every Claude Code session on this machine is a <b>chef</b>. Each prompt you send is an <b>order ticket</b>.
      Chefs run between stations as the agent works — the same way a sushi order needs nori, rice, fish, plating and serving.</p>
      <div class="menu-grid">${cards}</div>
      <div class="menu-extra">
        <div>${iconSvg('mystery', 26)}<span><b>Tickets</b> are prompts. The dish levels up as the order passes through the kitchen: Miso Soup → Sashimi → Maki Roll → Tempura → Bento Box → Omakase.</span></div>
        <div>${iconSvg('coin', 26)}<span><b>Coins</b>: 20 per served order plus a tip for speed. Cancelled orders cost 10.</span></div>
        <div>${iconSvg('fire', 26)}<span><b>Fires</b> are failed builds, tests or commands. Smoke means a minor slip (a failed read or edit).</span></div>
        <div>${iconSvg('hat', 26)}<span><b>Sous-chefs</b> (smaller, with bandanas) are sub-agents the head chef called in.</span></div>
        <div>${iconSvg('bell', 26)}<span>A chef at the <b>order bell</b> with a <b>?</b> is waiting on you.</span></div>
      </div>
      <p class="fine">Keys: <kbd>M</kbd> menu · <kbd>B</kbd> brigade · <kbd>Esc</kbd> close · click a chef to inspect it.</p>
    </div>`;
  }

  renderSettings() {
    const opt = (key, label, hint) => `<label class="opt"><input type="checkbox" data-key="${key}" ${this.settings[key] ? 'checked' : ''}><span><b>${label}</b><small>${hint}</small></span></label>`;
    const other = this.mode === 'demo' ? `<a class="btn" href="./">Switch to live kitchen</a>` : `<a class="btn" href="?demo">Watch a demo shift</a>`;
    this.settingsEl.innerHTML = `<h3>Settings</h3>
      ${opt('labels', 'Station labels', 'Show what each station means')}
      ${opt('chatter', 'Chef chatter', 'Speech bubbles with what the agent says')}
      ${opt('privacy', 'Hide prompts', 'Mask prompts, session names, file names and chatter (for screen sharing)')}
      ${opt('sound', 'Kitchen sounds', 'Dings for orders, sizzles for fires')}
      <div class="row">${other}</div>`;
    this.settingsEl.addEventListener('change', (ev) => {
      const key = ev.target.dataset.key;
      if (!key) return;
      this.settings[key] = ev.target.checked;
      this.saveSettings();
      this.lastRoster = null;
      this.renderRoster();
      document.body.classList.toggle('privacy', this.settings.privacy);
      this.store.emit('sessions', this.store.list());
    });
  }
}
