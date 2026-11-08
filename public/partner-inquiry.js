const form = document.getElementById('partnerInquiryForm');
const status = document.getElementById('partnerInquiryStatus');

let inquiriesEnabled = false;

function setFormEnabled(enabled) {
  inquiriesEnabled = enabled;

  if (form) {
    form.querySelectorAll('input,select,textarea,button').forEach(control => {
      control.disabled = !enabled;
    });
  }
}

if (form) {
  setFormEnabled(false);

  fetch('/api/partner-inquiry', {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  })
    .then(response => {
      if (!response.ok) throw new Error('Inquiry status unavailable.');
      return response.json();
    })
    .then(data => {
      if (data.enabled === true) {
        setFormEnabled(true);
        if (status) status.textContent = 'Partnership inquiries are open.';
      } else {
        setFormEnabled(false);
        if (status) status.textContent =
          data.message || 'Partnership inquiries are temporarily closed.';
      }
    })
    .catch(() => {
      setFormEnabled(false);
      if (status) status.textContent =
        'Partnership inquiry status is unavailable. Please try again later.';
    });
}

form?.addEventListener('submit', async event => {
  event.preventDefault();

  if (!inquiriesEnabled) {
    if (status) status.textContent = 'Partnership inquiries are temporarily closed.';
    return;
  }

  const button = form.querySelector('button[type="submit"]');
  if (!button || !status) return;

  button.disabled = true;
  status.textContent = 'Sending inquiry…';
  status.className = 'login-message';

  const data = Object.fromEntries(new FormData(form).entries());
  data.consent = form.elements.consent.checked;

  try {
    const response = await fetch('/api/partner-inquiry', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(data)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `Request failed (${response.status})`);
    }

    form.reset();
    status.textContent = result.message || 'Your inquiry has been received.';
    status.className = 'login-message success';
  } catch (error) {
    status.textContent = error.message;
    status.className = 'login-message error';
  } finally {
    button.disabled = !inquiriesEnabled;
  }
});
