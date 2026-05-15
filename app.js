// Plankworth — AI Tree Valuator client logic

const $ = (sel) => document.querySelector(sel);

const uploadZone = $('#upload-zone');
const photoInput = $('#photo-input');
const chooseBtn = $('#choose-btn');
const preview = $('#preview');
const analyzeBtn = $('#analyze-btn');
const btnLabel = analyzeBtn.querySelector('.btn-label');
const btnSpinner = analyzeBtn.querySelector('.btn-spinner');
const resultsEl = $('#results');
const errorBox = $('#error-box');
const trunkInput = $('#trunk-diameter');
const zipInput = $('#zip-code');

let imageDataUrl = null;

// === Upload handling ===
uploadZone.addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') photoInput.click();
});
chooseBtn.addEventListener('click', (e) => { e.stopPropagation(); photoInput.click(); });

uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleFile(file);
});

photoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (file.size > 10 * 1024 * 1024) {
    showError("That image is over 10MB. Try a smaller photo or compress it first.");
    return;
  }
  hideError();
  const reader = new FileReader();
  reader.onload = (ev) => {
    imageDataUrl = ev.target.result;
    preview.src = imageDataUrl;
    uploadZone.classList.add('has-image');
    analyzeBtn.disabled = false;
    if (window.posthog) posthog.capture('tool_photo_uploaded', { size_kb: Math.round(file.size / 1024) });
  };
  reader.readAsDataURL(file);
}

// === Analysis ===
analyzeBtn.addEventListener('click', async () => {
  if (!imageDataUrl) return;

  hideError();
  resultsEl.hidden = true;
  resultsEl.innerHTML = '';
  setLoading(true);

  const trunkDiameter = trunkInput.value ? parseFloat(trunkInput.value) : null;
  const zipCode = zipInput.value || null;

  if (window.posthog) posthog.capture('tool_analyze_started', { has_diameter: !!trunkDiameter, has_zip: !!zipCode });

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageDataUrl,
        trunk_diameter_inches: trunkDiameter,
        zip_code: zipCode
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Valuation failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    renderResults(data);
    if (window.posthog) posthog.capture('tool_analyze_completed', { species: data.species, payout: data.homeowner_payout_high });

  } catch (err) {
    console.error(err);
    showError(err.message || "Something went wrong — please try again in a minute.");
    if (window.posthog) posthog.capture('tool_analyze_failed', { error: String(err).slice(0, 200) });
  } finally {
    setLoading(false);
  }
});

function setLoading(loading) {
  analyzeBtn.disabled = loading;
  btnLabel.hidden = loading;
  btnSpinner.hidden = !loading;
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}
function hideError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

// === Render results ===
function renderResults(d) {
  const fmtMoney = (n) => '$' + Math.round(n).toLocaleString();
  const fmtRange = (lo, hi) => fmtMoney(lo) + '–' + fmtMoney(hi);

  const isSalvageGrade = d.homeowner_payout_high > 0 && d.condition_grade !== 'firewood';

  const payoutBanner = isSalvageGrade ? `
    <div class="payout-banner">
      <p class="payout-label">Likely mill payout to you</p>
      <p class="payout-value">${fmtRange(d.homeowner_payout_low, d.homeowner_payout_high)}</p>
      <p class="payout-sub">+ free removal (worth $${(d.likely_removal_cost_avoided || 800).toLocaleString()})</p>
    </div>
  ` : `
    <div class="payout-banner" style="background:var(--walnut)">
      <p class="payout-label">Estimated wood value</p>
      <p class="payout-value">${fmtRange(d.homeowner_payout_low, d.homeowner_payout_high)}</p>
      <p class="payout-sub">${d.condition_grade === 'firewood' ? 'Best use: firewood. Most mills will pass.' : 'May not be cost-effective for mills to extract.'}</p>
    </div>
  `;

  const ctaRow = isSalvageGrade ? `
    <div class="cta-row">
      <a href="#capture" class="btn-primary">Get connected with a paying mill →</a>
      <button class="btn-secondary" onclick="window.print()">Save this estimate</button>
    </div>
  ` : `
    <div class="cta-row">
      <a href="#capture" class="btn-secondary">Notify me if a mill ever wants this species</a>
    </div>
  `;

  resultsEl.innerHTML = `
    <div class="species-banner">
      <div class="species-name">${escapeHtml(d.species || 'Unknown species')}</div>
      ${d.species_confidence ? `<span class="confidence-badge">${Math.round(d.species_confidence * 100)}% confidence</span>` : ''}
    </div>

    ${payoutBanner}

    <div class="verdict-row">
      <div class="metric-card">
        <div class="metric-label">Est. trunk diameter</div>
        <div class="metric-value">${d.dbh_inches ? d.dbh_inches + '"' : '—'}</div>
      </div>
      <div class="metric-card highlight">
        <div class="metric-label">Board feet (saw-quality)</div>
        <div class="metric-value">${d.board_feet ? Math.round(d.board_feet).toLocaleString() + ' bf' : '—'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Retail lumber value</div>
        <div class="metric-value">${d.retail_value_low ? fmtRange(d.retail_value_low, d.retail_value_high) : '—'}</div>
      </div>
    </div>

    <div class="analysis-detail">
      <h4>Why this estimate</h4>
      <p>${escapeHtml(d.reasoning || 'Estimate based on visible trunk diameter, canopy condition, and species-specific retail board-foot pricing.')}</p>
    </div>

    ${d.condition_notes ? `
      <div class="analysis-detail">
        <h4>Condition assessment</h4>
        <p>${escapeHtml(d.condition_notes)}</p>
      </div>
    ` : ''}

    ${d.next_steps ? `
      <div class="analysis-detail">
        <h4>What to do next</h4>
        <p>${escapeHtml(d.next_steps)}</p>
      </div>
    ` : ''}

    ${ctaRow}
  `;

  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// === Email subscribe ===
const subForm = $('#subscribe-form');
const subStatus = $('#subscribe-status');
subForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#sub-email').value.trim();
  const zip = $('#sub-zip').value.trim();
  if (!email || !zip) return;

  subStatus.hidden = false;
  subStatus.textContent = "Saving…";
  subStatus.className = 'subscribe-status';

  try {
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, zip_code: zip })
    });
    if (!res.ok) throw new Error(await res.text());
    subStatus.textContent = "You're on the list. We'll only ping you when a buyer is looking for your area.";
    subStatus.className = 'subscribe-status success';
    subForm.reset();
    if (window.posthog) posthog.capture('subscribed', { source: 'tool_capture' });
  } catch (err) {
    subStatus.textContent = "Couldn't save — try again in a moment.";
    subStatus.className = 'subscribe-status error';
  }
});

// === Recent valuations ===
(async function loadRecent() {
  const el = $('#recent-list');
  try {
    const res = await fetch('/api/history?limit=6');
    if (!res.ok) throw new Error('history unavailable');
    const data = await res.json();
    if (!data.valuations || data.valuations.length === 0) {
      el.innerHTML = '<p class="muted">Be the first — upload a tree photo above.</p>';
      return;
    }
    el.innerHTML = data.valuations.map(v => `
      <div class="recent-card">
        <div class="rc-species">${escapeHtml(v.species || 'Unknown')}</div>
        <div class="rc-meta">${escapeHtml(v.zip_prefix || '—')} · ${v.dbh_inches ? v.dbh_inches + '" DBH' : ''}</div>
        <div class="rc-value">$${(v.homeowner_payout_low || 0).toLocaleString()}–$${(v.homeowner_payout_high || 0).toLocaleString()}</div>
      </div>
    `).join('');
  } catch (err) {
    el.innerHTML = '<p class="muted">Be the first — upload a tree photo above.</p>';
  }
})();
