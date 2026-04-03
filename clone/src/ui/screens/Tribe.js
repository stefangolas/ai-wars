// Tribe screen — create/manage alliance, members, diplomacy, forum.
import { store } from '../../state/store.js';

const MODES = ['overview', 'members', 'diplomacy', 'forum'];
const DIPLOMACY_LABELS = { ally: 'Alliance', nap: 'Non-Aggression', war: 'At War' };

export default {
  _mode: 'overview',

  mount(container, state) {
    this._mode = 'overview';
    const tribeId  = state.player?.tribeId ?? null;
    const tribe    = tribeId ? state.tribes[tribeId] : null;
    this._snapshot = JSON.stringify({ tribeId, tribe, error: state.error });
    this._render(container, state);
    this._bindEvents(container, state);
    // Sync tribe membership from server (player may already be in a tribe from a prior session)
    store.dispatch('GET_VILLAGE', {});
  },

  update(container, state) {
    // Only re-render when tribe data or error changes, not on every resource tick
    const tribeId  = state.player?.tribeId ?? null;
    const tribe    = tribeId ? state.tribes[tribeId] : null;
    const snapshot = JSON.stringify({ tribeId, tribe, error: state.error });
    if (snapshot === this._snapshot) return;
    this._snapshot = snapshot;
    this._render(container, state);
    this._bindEvents(container, state);
  },

  _render(container, state) {
    const tribeId = state.player?.tribeId ?? null;
    const tribe   = tribeId ? (state.tribes[tribeId] ?? null) : null;
    container.innerHTML = tribe
      ? renderTribeScreen(tribe, state, this._mode)
      : renderNoTribe(state);
  },

  _bindEvents(container, state) {
    // Mode tabs
    container.querySelectorAll('[data-mode]').forEach(tab => {
      tab.addEventListener('click', e => {
        e.preventDefault();
        this._mode = tab.dataset.mode;
        this._render(container, store.getState());
        this._bindEvents(container, store.getState());
      });
    });

    // Create tribe
    container.querySelector('#btn-create-tribe')?.addEventListener('click', () => {
      const nameEl = container.querySelector('#tribe-name');
      const tagEl  = container.querySelector('#tribe-tag');
      const descEl = container.querySelector('#tribe-desc');
      const name   = nameEl?.value.trim();
      const tag    = tagEl?.value.trim().toUpperCase();
      if (!name || !tag) { alert('Name and tag are required.'); return; }
      store.dispatch('CREATE_TRIBE', {
        name,
        tag: tag.slice(0, 8),
        description: descEl?.value.trim() ?? '',
      })?.then(msg => {
        if (msg && !msg.ok) {
          if (msg.error?.includes('Already in a tribe')) {
            // Client state is stale — re-sync from server to reveal the tribe screen
            store.dispatch('GET_VILLAGE', {});
          } else {
            alert(msg.error || 'Failed to create tribe');
          }
        }
      });
    });

    // Leave tribe (from tribe screen or from no-tribe screen when stuck)
    container.querySelector('#btn-leave-tribe')?.addEventListener('click', () => {
      if (confirm('Leave your tribe?')) store.dispatch('LEAVE_TRIBE', {});
    });
    container.querySelector('#btn-force-leave')?.addEventListener('click', () => {
      store.dispatch('LEAVE_TRIBE', {});
    });

    // Diplomacy buttons
    container.querySelectorAll('[data-diplo-tribe]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = parseInt(btn.dataset.diploTribe, 10);
        const status   = btn.dataset.diploStatus || null; // '' → null for Clear
        store.dispatch('SET_DIPLOMACY', { targetTribeId: targetId, status });
      });
    });

    // Forum post
    container.querySelector('#btn-post')?.addEventListener('click', () => {
      const input = container.querySelector('#forum-msg');
      const text  = input?.value.trim();
      if (!text) return;
      store.dispatch('POST_FORUM', { text });
      if (input) input.value = '';
    });
  },
};

function renderNoTribe(state) {
  return `
    <div id="tribe-screen">
      <h3>Tribe</h3>
      <p>You are not a member of any tribe.</p>
      ${state.error ? `
        <p class="warn" style="color:#c44">${escapeHtml(state.error)}</p>
        ${state.error.includes('Already in a tribe')
          ? `<p><button class="btn btn-build" id="btn-force-leave">Leave current tribe</button></p>`
          : ''}` : ''}
      <div class="vis" style="padding:12px;max-width:400px">
        <h4>Create a Tribe</h4>
        <table>
          <tr>
            <td><label>Name:</label></td>
            <td><input type="text" id="tribe-name" maxlength="50" style="width:200px"></td>
          </tr>
          <tr>
            <td><label>Tag:</label></td>
            <td><input type="text" id="tribe-tag" maxlength="8" style="width:80px"
                       placeholder="e.g. WAR"></td>
          </tr>
          <tr>
            <td><label>Description:</label></td>
            <td><textarea id="tribe-desc" rows="3" style="width:200px"></textarea></td>
          </tr>
          <tr>
            <td></td>
            <td><button class="btn btn-build" id="btn-create-tribe">Create Tribe</button></td>
          </tr>
        </table>
      </div>
    </div>`;
}

function renderTribeScreen(tribe, state, mode) {
  const tabBar = `
    <table class="vis modemenu">
      <tr>
        ${MODES.map(m => `
          <td class="${m === mode ? 'selected' : ''}" style="min-width:80px">
            <a href="#" data-mode="${m}">${m.charAt(0).toUpperCase() + m.slice(1)}</a>
          </td>`).join('')}
        <td style="min-width:80px">
          <a href="#" id="btn-leave-tribe" style="color:#c44">Leave</a>
        </td>
      </tr>
    </table>`;

  const body = {
    overview:  renderOverviewMode(tribe),
    members:   renderMembersMode(tribe, state),
    diplomacy: renderDiplomacyMode(tribe, state),
    forum:     renderForumMode(tribe, state),
  }[mode] ?? '';

  return `<div id="tribe-screen"><h3>Tribe: [${tribe.tag}] ${tribe.name}</h3>${tabBar}${body}</div>`;
}

function renderOverviewMode(tribe) {
  return `
    <div class="tribe-overview vis" style="padding:12px;margin-top:8px">
      <p><strong>Tag:</strong> [${tribe.tag}]</p>
      <p><strong>Members:</strong> ${tribe.members.length}</p>
      <p><strong>Description:</strong></p>
      <p>${tribe.description || '<em class="inactive">No description set.</em>'}</p>
    </div>`;
}

function renderMembersMode(tribe, state) {
  const members = tribe.members ?? [];
  return `
    <table class="vis" style="width:100%;margin-top:8px">
      <thead><tr><th>Player</th></tr></thead>
      <tbody>
        ${members.map(m => {
          const isMe = m.id === state.player.id;
          return `<tr>
            <td>${escapeHtml(m.name)} ${isMe ? '<em>(you)</em>' : ''}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function renderDiplomacyMode(tribe, state) {
  const otherTribes = tribe.otherTribes ?? [];
  if (otherTribes.length === 0) {
    return `<p class="inactive" style="margin-top:8px">No other tribes exist yet.</p>`;
  }

  return `
    <table class="vis" style="width:100%;margin-top:8px">
      <thead><tr><th>Tribe</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${otherTribes.map(t => {
          const status = tribe.diplomacy[t.id] ?? null;
          return `<tr>
            <td>[${t.tag}] ${t.name}</td>
            <td>${status ? DIPLOMACY_LABELS[status] : '—'}</td>
            <td>
              ${['ally','nap','war'].map(s =>
                `<button class="btn btn-small" data-diplo-tribe="${t.id}" data-diplo-status="${s}"
                         ${status === s ? 'disabled' : ''}>${DIPLOMACY_LABELS[s]}</button>`
              ).join(' ')}
                ${status ? `<button class="btn btn-small" data-diplo-tribe="${t.id}" data-diplo-status="">Clear</button>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function renderForumMode(tribe, state) {
  const posts = tribe.forum ?? [];
  return `
    <div id="tribe-forum" style="margin-top:8px">
      <div class="forum-posts">
        ${posts.length === 0
          ? `<p class="inactive">No posts yet.</p>`
          : posts.map(p => `
              <div class="forum-post">
                <span class="post-author">${escapeHtml(p.player_name ?? p.authorName ?? '')}</span>
                <span class="post-time inactive">${new Date(p.created_at ?? p.timestamp).toLocaleString()}</span>
                <div class="post-body">${escapeHtml(p.text)}</div>
              </div>`).join('')}
      </div>
      <div class="forum-compose">
        <textarea id="forum-msg" rows="3" style="width:100%"></textarea>
        <button class="btn btn-build" id="btn-post">Post</button>
      </div>
    </div>`;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
