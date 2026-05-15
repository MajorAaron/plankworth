// Plankworth — landing page email capture handler

const emailForm = document.getElementById('email-form');
const formStatus = document.getElementById('form-status');

if (emailForm) {
  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const zip = document.getElementById('zip').value.trim();
    if (!email || !zip) return;

    formStatus.hidden = false;
    formStatus.textContent = 'Saving…';
    formStatus.className = 'form-status';

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, zip_code: zip })
      });
      if (!res.ok) throw new Error(await res.text());

      formStatus.textContent = "You're on the list. We'll only ping you when a buyer is looking for your area.";
      formStatus.className = 'form-status success';
      emailForm.reset();
      if (window.posthog) posthog.capture('subscribed', { source: 'landing_capture' });
    } catch (err) {
      formStatus.textContent = "Couldn't save — try again in a moment.";
      formStatus.className = 'form-status error';
    }
  });
}

// Track tool CTAs
document.querySelectorAll('a[href="/tool.html"]').forEach(link => {
  link.addEventListener('click', () => {
    if (window.posthog) posthog.capture('tool_cta_clicked', { location: link.closest('section')?.className || 'unknown' });
  });
});
