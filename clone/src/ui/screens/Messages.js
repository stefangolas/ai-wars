// Private messaging screen — inbox, sent, compose.
import { store } from '../../state/store.js';

const FOLDERS = ['inbox', 'sent'];

export default {
  _folder:   'inbox',
  _compose:  false,
  _snapshot: null,

  mount(container, state) {
    this._folder  = 'inbox';
    this._compose = false;
    this._snapshot = null;
    store.dispatch('GET_MESSAGES', { folder: this._folder });
    store.dispatch('GET_PLAYERS', {});
    this._render(container, store.getState());
    this._bindEvents(container);
  },

  update(container, state) {
    const snap = JSON.stringify({
      messages:      state.messages,
      unreadMessages: state.unreadMessages,
      error:         state.error,
    });
    if (snap === this._snapshot) return;
    this._snapshot = snap;
    this._render(container, state);
    this._bindEvents(container);
  },

  _render(container, state) {
    container.innerHTML = this._compose
      ? renderCompose(state)
      : renderInbox(state, this._folder);
  },

  _bindEvents(container) {
    // Folder tabs
    container.querySelectorAll('[data-folder]').forEach(tab => {
      tab.addEventListener('click', e => {
        e.preventDefault();
        this._folder  = tab.dataset.folder;
        this._compose = false;
        store.dispatch('GET_MESSAGES', { folder: this._folder });
        this._render(container, store.getState());
        this._bindEvents(container);
      });
    });

    // Compose toggle
    container.querySelector('#btn-compose')?.addEventListener('click', () => {
      this._compose = true;
      this._render(container, store.getState());
      this._bindEvents(container);
    });

    container.querySelector('#btn-cancel-compose')?.addEventListener('click', () => {
      this._compose = false;
      this._render(container, store.getState());
      this._bindEvents(container);
    });

    // Send message
    container.querySelector('#btn-send-msg')?.addEventListener('click', () => {
      const toEl      = container.querySelector('#msg-to');
      const subjectEl = container.querySelector('#msg-subject');
      const textEl    = container.querySelector('#msg-text');
      const toPlayerId = parseInt(toEl?.value, 10);
      const text       = textEl?.value.trim();
      if (!toPlayerId) { alert('Select a recipient.'); return; }
      if (!text)       { alert('Message cannot be empty.'); return; }
      store.dispatch('SEND_MESSAGE', {
        toPlayerId,
        subject: subjectEl?.value.trim() ?? '',
        text,
      })?.then(msg => {
        if (msg?.ok) {
          this._compose = false;
          this._folder  = 'sent';
          store.dispatch('GET_MESSAGES', { folder: 'sent' });
          this._render(container, store.getState());
          this._bindEvents(container);
        } else {
          alert(msg?.error || 'Failed to send message');
        }
      });
    });
  },
};

function renderInbox(state, folder) {
  const messages = state.messages ?? [];
  const tabBar   = `
    <table class="vis modemenu">
      <tr>
        ${FOLDERS.map(f => `
          <td class="${f === folder ? 'selected' : ''}" style="min-width:80px">
            <a href="#" data-folder="${f}">${f.charAt(0).toUpperCase() + f.slice(1)}</a>
          </td>`).join('')}
        <td style="min-width:80px;text-align:right">
          <button class="btn btn-build" id="btn-compose">+ Compose</button>
        </td>
      </tr>
    </table>`;

  const rows = messages.length === 0
    ? `<tr><td colspan="4" class="inactive" style="text-align:center;padding:12px">No messages.</td></tr>`
    : messages.map(m => `
        <tr class="${!m.read && folder === 'inbox' ? 'unread' : ''}">
          <td style="width:30px">${!m.read && folder === 'inbox' ? '<strong>•</strong>' : ''}</td>
          <td>${escapeHtml(m.otherName)}</td>
          <td>${escapeHtml(m.subject || '(no subject)')}</td>
          <td class="inactive" style="white-space:nowrap">${new Date(m.createdAt).toLocaleString()}</td>
        </tr>
        <tr>
          <td></td>
          <td colspan="3" style="padding:4px 8px 12px;color:#666;font-size:0.9em">
            ${escapeHtml(m.text)}
          </td>
        </tr>`
    ).join('');

  return `
    <div id="messages-screen">
      <h3>Messages ${state.unreadMessages > 0 ? `<span class="badge">${state.unreadMessages}</span>` : ''}</h3>
      ${tabBar}
      <table class="vis" style="width:100%;margin-top:8px">
        <thead><tr>
          <th></th>
          <th>${folder === 'inbox' ? 'From' : 'To'}</th>
          <th>Subject</th>
          <th>Date</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderCompose(state) {
  const players = (state.players ?? []);
  return `
    <div id="messages-screen">
      <h3>New Message</h3>
      <div class="vis" style="padding:12px;max-width:500px;margin-top:8px">
        <table style="width:100%">
          <tr>
            <td style="width:80px"><label>To:</label></td>
            <td>
              <select id="msg-to" style="width:100%">
                <option value="">— select player —</option>
                ${players.map(p => `
                  <option value="${p.id}">${escapeHtml(p.name)}${p.tribe_tag ? ` [${p.tribe_tag}]` : ''}</option>
                `).join('')}
              </select>
            </td>
          </tr>
          <tr>
            <td><label>Subject:</label></td>
            <td><input type="text" id="msg-subject" maxlength="100" style="width:100%"></td>
          </tr>
          <tr>
            <td><label>Message:</label></td>
            <td><textarea id="msg-text" rows="6" style="width:100%"></textarea></td>
          </tr>
          <tr>
            <td></td>
            <td>
              <button class="btn btn-build" id="btn-send-msg">Send</button>
              <button class="btn" id="btn-cancel-compose" style="margin-left:8px">Cancel</button>
            </td>
          </tr>
        </table>
      </div>
    </div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
