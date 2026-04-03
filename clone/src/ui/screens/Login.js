// Login / Registration screen.
// Shown when no JWT token is present.
// On success, saves auth token and triggers app boot.

import { saveAuth } from '../../state/store.js';

export default {
  mount(container, onSuccess) {
    container.innerHTML = `
      <div class="login-wrap">
        <div class="login-box">
          <h1 class="login-title">Tribal Wars</h1>
          <div id="login-error" class="login-error" style="display:none"></div>

          <div class="login-tabs">
            <button class="login-tab active" data-tab="login">Login</button>
            <button class="login-tab" data-tab="register">Register</button>
          </div>

          <form id="login-form" class="login-form">
            <label>Username<input name="name" type="text" autocomplete="username" required></label>
            <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
            <button type="submit" class="btn">Login</button>
          </form>

          <form id="register-form" class="login-form" style="display:none">
            <label>Username (3–20 chars)<input name="name" type="text" autocomplete="username" required></label>
            <label>Password (min 6 chars)<input name="password" type="password" autocomplete="new-password" required></label>
            <button type="submit" class="btn">Create Account</button>
          </form>
        </div>
      </div>
    `;

    const errorEl    = container.querySelector('#login-error');
    const loginForm  = container.querySelector('#login-form');
    const regForm    = container.querySelector('#register-form');
    const tabs       = container.querySelectorAll('.login-tab');

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.style.display = 'block';
    }

    function hideError() { errorEl.style.display = 'none'; }

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        hideError();
        if (tab.dataset.tab === 'login') {
          loginForm.style.display = '';
          regForm.style.display   = 'none';
        } else {
          loginForm.style.display = 'none';
          regForm.style.display   = '';
        }
      });
    });

    async function submit(endpoint, name, password) {
      hideError();
      try {
        const res  = await fetch(endpoint, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name, password }),
        });
        const data = await res.json();
        if (!data.ok) { showError(data.error); return; }
        saveAuth(data.token, data.playerId, name);
        onSuccess();
      } catch {
        showError('Could not reach server. Is it running?');
      }
    }

    loginForm.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(loginForm);
      submit('/auth/login', fd.get('name'), fd.get('password'));
    });

    regForm.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(regForm);
      submit('/auth/register', fd.get('name'), fd.get('password'));
    });
  },
};
