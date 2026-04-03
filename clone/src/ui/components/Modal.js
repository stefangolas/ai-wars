// Simple modal dialog component.
// Usage:
//   Modal.open({ title: 'Confirm', body: '<p>Sure?</p>', onConfirm: () => {} });
//   Modal.close();

export const Modal = {
  _el: null,

  open({ title = '', body = '', onConfirm = null, confirmLabel = 'Confirm', showCancel = true }) {
    this.close(); // close any existing modal

    const el = document.createElement('div');
    el.className = 'modal-overlay';
    el.innerHTML = `
      <div class="modal-box vis">
        <div class="modal-header">
          <span class="modal-title">${title}</span>
          <button class="modal-close btn-icon" title="Close">✕</button>
        </div>
        <div class="modal-body">${body}</div>
        ${onConfirm || showCancel ? `
          <div class="modal-footer">
            ${showCancel ? `<button class="btn btn-cancel">Cancel</button>` : ''}
            ${onConfirm  ? `<button class="btn btn-confirm">${confirmLabel}</button>` : ''}
          </div>` : ''}
      </div>`;

    el.querySelector('.modal-close')?.addEventListener('click', () => this.close());
    el.querySelector('.btn-cancel')?.addEventListener('click', () => this.close());
    el.querySelector('.btn-confirm')?.addEventListener('click', () => {
      onConfirm?.();
      this.close();
    });
    el.addEventListener('click', e => { if (e.target === el) this.close(); });

    document.body.appendChild(el);
    this._el = el;
  },

  close() {
    this._el?.remove();
    this._el = null;
  },
};
