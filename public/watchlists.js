const $ = id => document.getElementById(id);
const root = $('watchlistsRoot');

if (root) {
  let csrf = '';
  let lists = [];

  const status = message => { $('watchlistsStatus').textContent = message; };

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body) headers.set('Content-Type', 'application/json');
    if (options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrf);
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  function makeButton(label, className = 'text-btn') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
  }

  function render() {
    const output = $('watchlistsOutput');
    output.replaceChildren();

    if (!lists.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No saved watchlists yet.';
      output.append(empty);
      return;
    }

    for (const list of lists) {
      const card = document.createElement('article');
      card.className = 'watchlist-entry';

      const heading = document.createElement('h4');
      heading.textContent = list.name;
      card.append(heading);

      const actions = document.createElement('div');
      actions.className = 'watchlist-actions';

      const rename = makeButton('Rename');
      rename.addEventListener('click', () => {
        if (card.querySelector('.watchlist-rename-form')) return;
        const form = document.createElement('form');
        form.className = 'watchlist-rename-form';
        const label = document.createElement('label');
        label.textContent = 'New watchlist name';
        const input = document.createElement('input');
        input.required = true;
        input.maxLength = 40;
        input.value = list.name;
        input.setAttribute('aria-label', 'New watchlist name');
        const save = document.createElement('button');
        save.type = 'submit';
        save.className = 'btn primary';
        save.textContent = 'Save name';
        const cancel = makeButton('Cancel');
        cancel.addEventListener('click', () => form.remove());
        form.append(label, input, save, cancel);
        card.insertBefore(form, actions);
        input.focus();
        input.select();
        form.addEventListener('submit', async event => {
          event.preventDefault();
          save.disabled = true;
          try {
            await api(`/api/watchlists/${encodeURIComponent(list.id)}`, {
              method: 'PATCH',
              body: JSON.stringify({ name: input.value })
            });
            await load();
            status('Watchlist renamed.');
          } catch (error) {
            status(error.message);
            save.disabled = false;
          }
        });
      });

      const remove = makeButton('Delete', 'portfolio-remove');
      remove.addEventListener('click', async () => {
        if (!remove.dataset.confirming) {
          remove.dataset.confirming = 'true';
          remove.textContent = 'Confirm delete';
          remove.classList.add('is-confirming');
          const cancel = makeButton('Cancel');
          cancel.className = 'portfolio-remove';
          cancel.addEventListener('click', () => {
            delete remove.dataset.confirming;
            remove.textContent = 'Delete';
            remove.classList.remove('is-confirming');
            cancel.remove();
          });
          actions.append(cancel);
          return;
        }
        remove.disabled = true;
        remove.textContent = 'Deleting…';
        try {
          await api(`/api/watchlists/${encodeURIComponent(list.id)}`, { method: 'DELETE' });
          await load();
          status('Watchlist and its saved tickers deleted.');
          window.dispatchEvent(new CustomEvent('raelinfo:data-changed'));
        } catch (error) {
          status(error.message);
          remove.disabled = false;
          remove.textContent = 'Delete';
          delete remove.dataset.confirming;
          remove.classList.remove('is-confirming');
        }
      });

      actions.append(rename, remove);
      card.append(actions);

      const form = document.createElement('form');
      form.className = 'watchlist-symbol-form';
      const input = document.createElement('input');
      input.required = true;
      input.maxLength = 15;
      input.placeholder = 'Ticker (e.g. AAPL)';
      input.setAttribute('aria-label', 'Ticker');
      const add = document.createElement('button');
      add.type = 'submit';
      add.className = 'btn primary';
      add.textContent = 'Add ticker';
      form.append(input, add);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        add.disabled = true;
        try {
          await api(`/api/watchlists/${encodeURIComponent(list.id)}/items`, {
            method: 'POST',
            body: JSON.stringify({ symbol: input.value })
          });
          await load();
          status('Ticker saved.');
        } catch (error) {
          status(error.message);
          add.disabled = false;
        }
      });
      card.append(form);

      const row = document.createElement('div');
      row.className = 'watchlist-symbols';
      for (const item of list.items || []) {
        const chip = document.createElement('span');
        chip.className = 'watchlist-chip';
        const symbol = document.createElement('strong');
        symbol.textContent = item.symbol;
        const removeTicker = makeButton('×');
        removeTicker.setAttribute('aria-label', `Remove ${item.symbol}`);
        removeTicker.addEventListener('click', async () => {
          removeTicker.disabled = true;
          try {
            await api(`/api/watchlists/${encodeURIComponent(list.id)}/items?symbol=${encodeURIComponent(item.symbol)}`, {
              method: 'DELETE'
            });
            await load();
            status(`${item.symbol} removed.`);
          } catch (error) {
            status(error.message);
            removeTicker.disabled = false;
          }
        });
        chip.append(symbol, removeTicker);
        row.append(chip);
      }
      card.append(row);
      output.append(card);
    }
  }

  async function load() {
    const data = await api('/api/watchlists');
    lists = data.watchlists || [];
    render();
  }

  async function init() {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      const auth = await response.json();
      if (!response.ok || !auth.authenticated || !auth.csrfToken || auth.deletionPending) {
        const signedOut = $('watchlistsSignedOut');
        signedOut.hidden = false;
        $('watchlistsWorkspace').hidden = true;
        if (auth.deletionPending) {
          signedOut.textContent = 'Permanent account deletion is pending. Watchlists are locked while deletion is being completed. Return to the portfolio account panel to retry deletion.';
        }
        return;
      }
      csrf = auth.csrfToken;
      $('watchlistsSignedOut').hidden = true;
      $('watchlistsWorkspace').hidden = false;
      await load();
    } catch {
      status('Could not verify your account. Refresh and try again.');
    }
  }

  $('watchlistCreateForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api('/api/watchlists', {
        method: 'POST',
        body: JSON.stringify({ name: $('watchlistName').value })
      });
      $('watchlistName').value = '';
      await load();
      status('Watchlist created.');
      window.dispatchEvent(new CustomEvent('raelinfo:data-changed'));
    } catch (error) {
      status(error.message);
    } finally {
      submit.disabled = false;
    }
  });

  window.addEventListener('raelinfo:data-changed', () => {
    if (!$('watchlistsWorkspace').hidden) load().catch(error => status(error.message));
  });

  init();
}