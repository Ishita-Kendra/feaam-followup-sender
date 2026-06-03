/* ── FEAAM Priority Sender — Read → Approve → Send ─────────── */

// ── State ──────────────────────────────────────────────────────
let allLeads      = [];
let filteredLeads = [];
let approvalQueue = [];   // leads moved to approvals
let selectedLead  = null;
let selectedApproval = null;
let activeFilter  = 'all';
let searchQuery   = '';

// ── Nav ────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-' + view).classList.add('active');
    if (view === 'sent')      loadSentLog();
    if (view === 'settings')  loadSettings();
    if (view === 'approvals') renderApprovalQueue();
    if (view === 'leads')     renderLeads();
    if (view === 'library')   loadLibrary();
  });
});

// ── Upload ─────────────────────────────────────────────────────
const dropZone  = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
dropZone.addEventListener('click', () => fileInput.click());

function handleFile(file) {
  const progress = document.getElementById('uploadProgress');
  const result   = document.getElementById('uploadResult');
  progress.classList.remove('hidden');
  result.classList.add('hidden');
  document.getElementById('dropLabel').textContent = file.name;

  const fd = new FormData();
  fd.append('file', file);
  fetch('/api/upload', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      progress.classList.add('hidden');
      if (!data.ok) {
        result.className = 'upload-result err';
        result.innerHTML = '❌ ' + esc(data.error);
        result.classList.remove('hidden');
        return;
      }
      allLeads = data.leads;
      showUploadResult(data);
      applyFilter();

      // Always start research polling — deep research runs on all top 25
      startResearchPolling(data.ai_count || data.total);
    })
    .catch(err => {
      progress.classList.add('hidden');
      result.className = 'upload-result err';
      result.innerHTML = '❌ ' + esc(err.message);
      result.classList.remove('hidden');
    });
}

function showUploadResult(data) {
  const result = document.getElementById('uploadResult');
  result.className = 'upload-result ok';
  result.innerHTML = `
    ✅ <strong>Top ${data.total} leads loaded and ranked</strong>
    <div class="result-stats">
      <div class="stat"><span class="stat-num p1c">${data.p1}</span><span class="stat-lab">Priority 1</span></div>
      <div class="stat"><span class="stat-num p2c">${data.p2}</span><span class="stat-lab">Priority 2</span></div>
      <div class="stat"><span class="stat-num puc">${data.unknown}</span><span class="stat-lab">Size unknown</span></div>
    </div>
    <div style="font-size:12px;color:#8b949e;margin-top:8px">🔍 Deep-researching all ${data.total} companies — emails update as each completes</div>
    <button class="btn-goto-leads" onclick="gotoLeads()">View Priority List →</button>
  `;
  result.classList.remove('hidden');
}

let _researchPollTimer = null;

function startResearchPolling(total) {
  const bar  = document.getElementById('researchBar');
  const fill = document.getElementById('researchFill');
  const sub  = document.getElementById('researchSub');
  bar.classList.remove('hidden', 'done');

  function poll() {
    fetch('/api/research-status')
      .then(r => r.json())
      .then(d => {
        const done  = d.done || 0;
        const ttl   = d.total || total || 1;
        const pct   = Math.round((done / ttl) * 100);
        fill.style.width = pct + '%';

        // Find which company is currently being researched
        const researching = (d.leads || []).find(l => l.research_status === 'researching');
        if (researching) {
          sub.textContent = `Researching ${researching.company} (${done}/${ttl})…`;
        } else {
          sub.textContent = `Researched ${done} of ${ttl} companies…`;
        }

        // Progressive update — merge research results into allLeads
        if (d.leads && d.leads.length) {
          d.leads.forEach(updated => {
            const idx = allLeads.findIndex(l => l.id === updated.id);
            if (idx !== -1) {
              // Preserve approved/sent state
              const was = allLeads[idx];
              allLeads[idx] = { ...updated, approved: was.approved, sent: was.sent, cs_files: was.cs_files };
            }
          });
          // If a lead is currently selected, refresh its panel
          if (selectedLead) {
            const fresh = allLeads.find(l => l.id === selectedLead.id);
            if (fresh && fresh.research_status === 'done' && selectedLead.research_status !== 'done') {
              selectedLead = fresh;
              selectLead(fresh.id);
            }
          }
          applyFilter();
        }

        if (d.status === 'done') {
          allLeads = d.leads.map(updated => {
            const was = allLeads.find(l => l.id === updated.id) || {};
            return { ...updated, approved: was.approved, sent: was.sent, cs_files: was.cs_files };
          });
          bar.classList.add('done');
          fill.style.width = '100%';
          sub.textContent  = `✓ Research complete — ${done} companies analysed, emails personalised`;
          const p1 = allLeads.filter(l => l.priority === 1).length;
          const p2 = allLeads.filter(l => l.priority === 2).length;
          const pu = allLeads.filter(l => l.priority === 0).length;
          document.getElementById('uploadResult').innerHTML = `
            ✅ <strong>Top ${allLeads.length} leads ranked &amp; researched</strong>
            <div class="result-stats">
              <div class="stat"><span class="stat-num p1c">${p1}</span><span class="stat-lab">Priority 1</span></div>
              <div class="stat"><span class="stat-num p2c">${p2}</span><span class="stat-lab">Priority 2</span></div>
              <div class="stat"><span class="stat-num puc">${pu}</span><span class="stat-lab">Size unknown</span></div>
            </div>
            <button class="btn-goto-leads" onclick="gotoLeads()">View Priority List →</button>
          `;
          applyFilter();
        } else if (d.status === 'error') {
          bar.style.borderColor = '#f85149';
          sub.textContent = d.error || 'Research error — check Settings → Anthropic API Key';
        } else {
          _researchPollTimer = setTimeout(poll, 2500);
        }
      })
      .catch(() => { _researchPollTimer = setTimeout(poll, 5000); });
  }
  poll();
}

function gotoLeads() {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelector('[data-view="leads"]').classList.add('active');
  document.getElementById('view-leads').classList.add('active');
  renderLeads();
}

// ── Filter & search ────────────────────────────────────────────
document.getElementById('searchBox').addEventListener('input', e => {
  searchQuery = e.target.value.toLowerCase();
  applyFilter();
});
document.querySelectorAll('.pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activeFilter = pill.dataset.filter;
    applyFilter();
  });
});

function applyFilter() {
  filteredLeads = allLeads.filter(l => {
    const matchFilter =
      activeFilter === 'all'     ? true :
      activeFilter === 'pending' ? !l.approved && !l.sent :
      String(l.priority) === activeFilter;
    const q = searchQuery;
    const matchSearch = !q ||
      (l.company      || '').toLowerCase().includes(q) ||
      (l.full_name    || '').toLowerCase().includes(q) ||
      (l.sector_label || '').toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });
  renderLeads();
}

// ── Render leads list ──────────────────────────────────────────
function renderLeads() {
  const list = document.getElementById('leadsList');
  if (!allLeads.length) {
    list.innerHTML = '<div class="empty-state">Upload a leads file to see the priority list.</div>';
    return;
  }
  applyFilter();
  if (!filteredLeads.length) {
    list.innerHTML = '<div class="empty-state">No leads match this filter.</div>';
    return;
  }
  list.innerHTML = filteredLeads.map(l => {
    const cls = l.sent ? 'is-sent' : l.approved ? 'is-approved' : '';
    const sel = selectedLead && selectedLead.id === l.id ? 'selected' : '';
    const badgeCls = l.sent ? 'sent' : l.approved ? 'approved' :
                     l.priority === 1 ? 'p1' : l.priority === 2 ? 'p2' : 'pu';
    const badgeTxt = l.sent ? '✓' : l.approved ? '✓' :
                     l.priority === 1 ? 'P1' : l.priority === 2 ? 'P2' : '?';
    const statusTag = l.sent
      ? '<div class="lead-status-tag sent">✓ Sent</div>'
      : l.approved
        ? '<div class="lead-status-tag approved">✓ In approval queue</div>'
        : '';
    // Research status indicator
    const rs = l.research_status || 'pending';
    const researchIndicator = rs === 'done'
      ? '<span class="research-dot done" title="Research complete">✓</span>'
      : rs === 'researching'
        ? '<span class="research-dot spinning" title="Researching…">⟳</span>'
        : '<span class="research-dot pending" title="Pending research">…</span>';
    return `
      <div class="lead-card ${cls} ${sel}" data-id="${l.id}">
        <span class="badge ${badgeCls}">${badgeTxt}</span>
        <div class="lead-info">
          <div class="lead-company">${esc(l.company || '—')} ${researchIndicator}</div>
          <div class="lead-name">${esc(l.full_name || '')}${l.job_title ? ' · ' + esc(l.job_title) : ''}</div>
          <div class="lead-sector">${esc(l.sector_label || 'Sector unknown')}${l.employees ? ' · ' + l.employees.toLocaleString() + ' employees' : ''}${l.emp_source === 'ai' ? ' 🔍' : ''}</div>
          ${statusTag}
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.lead-card').forEach(card => {
    card.addEventListener('click', () => selectLead(card.dataset.id));
  });
}

// ── Select lead → populate READ panel ─────────────────────────
function selectLead(id) {
  selectedLead = allLeads.find(l => l.id === id);
  if (!selectedLead) return;

  // Update selection highlight
  document.querySelectorAll('.lead-card').forEach(c =>
    c.classList.toggle('selected', c.dataset.id === id));

  const placeholder = document.getElementById('readPlaceholder');
  const content     = document.getElementById('readContent');
  placeholder.classList.add('hidden');
  content.classList.remove('hidden');

  const l = selectedLead;
  const badgeCls = l.priority === 1 ? 'p1' : l.priority === 2 ? 'p2' : 'pu';
  const badgeTxt = l.priority === 1 ? 'Priority 1 — Medium company' :
                   l.priority === 2 ? 'Priority 2 — Large company' :
                   'Size unknown';

  // Contact header
  document.getElementById('readContact').innerHTML = `
    <div class="contact-left">
      <div class="contact-name">${esc(l.full_name || '—')}</div>
      <div class="contact-meta">
        ${esc(l.job_title || 'Unknown title')}
        ${l.location ? ' &nbsp;·&nbsp; ' + esc(l.location) : ''}
        ${l.company  ? ' &nbsp;·&nbsp; ' + esc(l.company)  : ''}
      </div>
      <div class="contact-email-link">${esc(l.email || 'No email address')}</div>
      <div class="contact-badges">
        <span class="badge ${badgeCls}">${badgeTxt}</span>
        ${l.sector_label ? `<span class="badge pu">${esc(l.sector_label)}</span>` : ''}
        ${l.approved ? '<span class="badge approved">✓ In queue</span>' : ''}
        ${researchBadge}
      </div>
      ${l.feaam_fit ? `<div class="research-summary">${esc(l.feaam_fit)}</div>` : ''}
    </div>
  `;

  // Email preview fields
  document.getElementById('previewTo').textContent      = `${l.full_name || ''} <${l.email || ''}>`;
  document.getElementById('previewSubject').textContent = l.subject || '';

  // Attachment — shown prominently
  const attachEl = document.getElementById('previewAttachment');
  if (l.deck_fname) {
    attachEl.innerHTML = l.deck_exists
      ? `<span class="attach-chip ok">📎 ${esc(l.deck_fname)}</span>`
      : `<span class="attach-chip missing">📎 ${esc(l.deck_fname)} <span class="attach-warn">⚠ file not found</span></span>`;
  } else {
    attachEl.innerHTML = '<span class="attach-chip missing">No deck matched for this sector</span>';
  }

  // Research status in read panel
  const rs = l.research_status || 'pending';
  const researchBadge = rs === 'done'
    ? `<span class="research-badge done">✓ Research complete</span>`
    : rs === 'researching'
      ? `<span class="research-badge running">⟳ Researching now…</span>`
      : `<span class="research-badge pending">Pending research</span>`;

  document.getElementById('previewBody').textContent = l.body || '';

  // Case studies
  const csList = document.getElementById('csPreviewList');
  if (l.suggested_cs && l.suggested_cs.length) {
    csList.innerHTML = l.suggested_cs.map(cs => `
      <label class="cs-check-item">
        <input type="checkbox" class="cs-check-read" data-fname="${esc(cs.filename)}" checked/>
        <label>${esc(cs.label)}</label>
      </label>`).join('');
    document.getElementById('csPreviewSection').classList.remove('hidden');
  } else {
    document.getElementById('csPreviewSection').classList.add('hidden');
  }

  // Approve button state
  const btnApprove = document.getElementById('btnApprove');
  if (l.sent) {
    btnApprove.textContent = '✓ Already Sent';
    btnApprove.disabled    = true;
    btnApprove.style.opacity = '.5';
  } else if (l.approved) {
    btnApprove.textContent = '✓ Already in Queue';
    btnApprove.disabled    = false;
    btnApprove.style.opacity = '.7';
  } else {
    btnApprove.textContent = 'Approve → Queue ✓';
    btnApprove.disabled    = false;
    btnApprove.style.opacity = '1';
  }

  // Clear result
  const r = document.getElementById('readResult');
  r.className = 'action-result hidden';
}

// ── Approve button ─────────────────────────────────────────────
document.getElementById('btnApprove').addEventListener('click', () => {
  if (!selectedLead || selectedLead.sent) return;

  const csFiles = [...document.querySelectorAll('.cs-check-read:checked')]
    .map(c => c.dataset.fname);

  selectedLead.approved  = true;
  selectedLead.cs_files  = csFiles;

  // Add to queue if not already there
  if (!approvalQueue.find(a => a.id === selectedLead.id)) {
    approvalQueue.push({ ...selectedLead });
  } else {
    // Update cs_files
    const idx = approvalQueue.findIndex(a => a.id === selectedLead.id);
    approvalQueue[idx].cs_files = csFiles;
  }

  updateApprovalBadge();
  renderLeads();

  // Flash feedback
  const r = document.getElementById('readResult');
  r.className = 'action-result ok';
  r.textContent = '✓ Added to Approval Queue — go to the Approvals tab to review and edit before sending.';
  r.classList.remove('hidden');
  setTimeout(() => r.classList.add('hidden'), 5000);

  // Update button
  document.getElementById('btnApprove').textContent = '✓ Already in Queue';
  document.getElementById('btnApprove').style.opacity = '.7';
});

// ── Regenerate ─────────────────────────────────────────────────
document.getElementById('btnRegenerate').addEventListener('click', () => {
  if (!selectedLead) return;
  fetch(`/api/lead/${selectedLead.id}/regenerate`, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        selectedLead.subject = data.subject;
        selectedLead.body    = data.body;
        document.getElementById('previewSubject').textContent = data.subject;
        document.getElementById('previewBody').textContent    = data.body;
        // Also update in queue if present
        const qa = approvalQueue.find(a => a.id === selectedLead.id);
        if (qa) { qa.subject = data.subject; qa.body = data.body; }
        flashResult('readResult', 'ok', '↺ Email regenerated');
      }
    });
});

// ── Approval badge ─────────────────────────────────────────────
function updateApprovalBadge() {
  const pending = approvalQueue.filter(a => !a.sent).length;
  const badge = document.getElementById('approvalBadge');
  if (pending > 0) {
    badge.textContent = pending;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
  document.getElementById('queueCount').textContent = pending + ' email' + (pending === 1 ? '' : 's');
}

// ── Render approval queue ──────────────────────────────────────
function renderApprovalQueue() {
  updateApprovalBadge();
  const list = document.getElementById('approvalQueueList');
  if (!approvalQueue.length) {
    list.innerHTML = '<div class="empty-state">No emails approved yet.<br>Go to Priority List and click Approve → Queue.</div>';
    return;
  }
  list.innerHTML = approvalQueue.map(a => `
    <div class="approval-item ${a.sent ? 'is-sent' : ''} ${selectedApproval && selectedApproval.id === a.id ? 'selected' : ''}"
         data-id="${a.id}">
      <div class="approval-co">${esc(a.company || '—')}</div>
      <div class="approval-name">${esc(a.full_name || '')}${a.job_title ? ' · ' + esc(a.job_title) : ''}</div>
      <div class="approval-sector">${esc(a.sector_label || 'Unknown sector')} ${a.sent ? '· ✓ Sent' : ''}</div>
    </div>`).join('');

  list.querySelectorAll('.approval-item').forEach(item => {
    item.addEventListener('click', () => selectApproval(item.dataset.id));
  });
}

// ── Select approval → populate edit panel ─────────────────────
function selectApproval(id) {
  selectedApproval = approvalQueue.find(a => a.id === id);
  if (!selectedApproval) return;

  document.querySelectorAll('.approval-item').forEach(c =>
    c.classList.toggle('selected', c.dataset.id === id));

  document.getElementById('approvalPlaceholder').classList.add('hidden');
  document.getElementById('approvalEditContent').classList.remove('hidden');

  const a = selectedApproval;

  document.getElementById('approvalContactBar').innerHTML = `
    <div style="font-weight:700;color:#e6edf3">${esc(a.full_name || '—')}</div>
    <div style="font-size:12px;color:#8b949e;margin-top:4px">
      ${esc(a.job_title || '')}${a.company ? ' · ' + esc(a.company) : ''}
      ${a.location ? ' · ' + esc(a.location) : ''}
    </div>
    <div style="color:#58a6ff;font-size:13px;margin-top:5px">${esc(a.email || '')}</div>
  `;

  document.getElementById('approvalSubject').value = a.subject || '';
  document.getElementById('approvalBody').value    = a.body    || '';

  // Deck chip
  const chip = document.getElementById('approvalDeckChip');
  if (a.deck_fname) {
    chip.className   = a.deck_exists ? 'deck-chip' : 'deck-chip missing';
    chip.textContent = a.deck_fname + (a.deck_exists ? '' : ' ⚠ not found');
  } else {
    chip.className   = 'deck-chip missing';
    chip.textContent = 'No deck matched';
  }

  // Case studies
  const csList = document.getElementById('approvalCsList');
  if (a.cs_files && a.cs_files.length) {
    csList.innerHTML = a.cs_files.map(f => `
      <div class="cs-attach-item">📄 ${esc(f)}</div>`).join('');
  } else {
    csList.innerHTML = '<div style="font-size:12px;color:#6e7681">None selected</div>';
  }

  // Send button state
  const btnSend = document.getElementById('btnSend');
  if (a.sent) {
    btnSend.textContent = '✓ Sent';
    btnSend.className   = 'btn-send disabled-send';
  } else {
    btnSend.innerHTML = 'Send ✉ <span class="send-note">(configure SMTP in Settings to enable)</span>';
    // Will be enabled once SMTP is configured — for now kept disabled-style but clickable for testing
    btnSend.className = 'btn-send disabled-send';
  }

  document.getElementById('sendResult').className = 'send-result hidden';
  document.getElementById('sendConfirm').classList.add('hidden');
}

// ── Save edits in approval ─────────────────────────────────────
document.getElementById('btnSaveApproval').addEventListener('click', () => {
  if (!selectedApproval) return;
  selectedApproval.subject = document.getElementById('approvalSubject').value;
  selectedApproval.body    = document.getElementById('approvalBody').value;
  // Sync back to allLeads
  const l = allLeads.find(x => x.id === selectedApproval.id);
  if (l) { l.subject = selectedApproval.subject; l.body = selectedApproval.body; }
  flashResult('sendResult', 'ok', '✓ Edits saved');
});

// ── Remove from queue ──────────────────────────────────────────
document.getElementById('btnRemoveApproval').addEventListener('click', () => {
  if (!selectedApproval) return;
  approvalQueue = approvalQueue.filter(a => a.id !== selectedApproval.id);
  const l = allLeads.find(x => x.id === selectedApproval.id);
  if (l) l.approved = false;
  selectedApproval = null;
  document.getElementById('approvalPlaceholder').classList.remove('hidden');
  document.getElementById('approvalEditContent').classList.add('hidden');
  renderApprovalQueue();
  updateApprovalBadge();
  renderLeads();
});

// ── Send (placeholder — full SMTP coming later) ────────────────
document.getElementById('btnSend').addEventListener('click', () => {
  if (!selectedApproval || selectedApproval.sent) return;
  // Check if SMTP is configured
  fetch('/api/settings')
    .then(r => r.json())
    .then(data => {
      if (!data.settings.smtp_user) {
        flashResult('sendResult', 'err', '❌ SMTP not configured. Go to Settings and enter your Ionos email address.');
        return;
      }
      document.getElementById('confirmTo').textContent   = `${selectedApproval.full_name} <${selectedApproval.email}>`;
      document.getElementById('confirmSubj').textContent = document.getElementById('approvalSubject').value;
      document.getElementById('sendConfirm').classList.remove('hidden');
    });
});

document.getElementById('btnCancelSend').addEventListener('click', () => {
  document.getElementById('sendConfirm').classList.add('hidden');
});

document.getElementById('btnConfirmSend').addEventListener('click', () => {
  document.getElementById('sendConfirm').classList.add('hidden');
  const payload = {
    lead_id:      selectedApproval.id,
    subject:      document.getElementById('approvalSubject').value,
    body:         document.getElementById('approvalBody').value,
    case_studies: selectedApproval.cs_files || [],
  };
  fetch('/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      selectedApproval.sent = true;
      const l = allLeads.find(x => x.id === selectedApproval.id);
      if (l) { l.sent = true; l.sent_at = new Date().toISOString().slice(0,19).replace('T',' '); }
      flashResult('sendResult', 'ok', '✉ ' + data.message);
      document.getElementById('btnSend').className   = 'btn-send disabled-send';
      document.getElementById('btnSend').textContent = '✓ Sent';
      renderApprovalQueue();
      updateApprovalBadge();
      renderLeads();
    } else {
      flashResult('sendResult', 'err', '❌ ' + data.error);
    }
  });
});

// ── Reference Library ──────────────────────────────────────────
function loadLibrary() {
  fetch('/api/library').then(r => r.json()).then(data => {
    if (!data.ok) return;
    renderTier('libOverall',   data.overall,   'overall');
    renderTier('libFollowup1', data.followup1, 'followup1', true);
    renderTier('libFollowup2', data.followup2, 'followup2', true);
  });
}

function renderTier(containerId, files, tier, hasFixed = false) {
  const container = document.getElementById(containerId);
  if (!files || !files.length) {
    container.innerHTML = '<div class="lib-loading">No files uploaded yet.</div>';
    return;
  }
  container.innerHTML = files.map((f, i) => {
    const replaceUrl = f.fixed && f.sector_key
      ? `/api/library/followup1/deck/${f.sector_key}`
      : f.fixed && tier === 'followup2'
        ? `/api/library/followup2/case-study/${i}`
        : null;

    return `
    <div class="lib-card ${f.exists ? 'ok' : 'missing'}">
      <div class="lib-card-title">
        <span class="lib-status-dot ${f.exists ? 'ok' : 'missing'}"></span>
        ${esc(f.label || f.filename)}
      </div>
      ${f.description ? `<div class="lib-card-sub">${esc(f.description)}</div>` : ''}
      <div class="lib-card-meta">
        ${f.exists
          ? `${f.size_kb} KB &nbsp;·&nbsp; updated ${esc(f.modified)}`
          : '⚠ Not uploaded yet'}
      </div>
      <div class="lib-card-actions">
        <label class="lib-btn-replace">
          ${f.exists ? '↑ Replace' : '↑ Upload'}
          <input type="file" accept=".pdf,.pptx,.docx,.txt"
            onchange="replaceLibraryFile('${tier}', '${esc(f.filename)}', '${esc(f.sector_key||'')}', ${i}, this, ${!!f.fixed})"/>
        </label>
        ${f.exists
          ? `<a class="lib-btn-download" href="/api/library/download/${tier}/${encodeURIComponent(f.filename)}" download>↓ Get</a>`
          : ''}
        ${!f.fixed
          ? `<button class="lib-btn-delete" onclick="deleteLibraryFile('${tier}','${esc(f.filename)}')">✕</button>`
          : ''}
      </div>
    </div>`;
  }).join('');
}

function replaceLibraryFile(tier, fname, sectorKey, index, input, isFixed) {
  const file = input.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  let url;
  if (isFixed && sectorKey) url = `/api/library/followup1/deck/${sectorKey}`;
  else if (isFixed && tier === 'followup2') url = `/api/library/followup2/case-study/${index}`;
  else url = `/api/library/${tier}/upload`;
  if (!isFixed) { fd.append('label', fname); }
  fetch(url, { method: 'POST', body: fd })
    .then(r => r.json())
    .then(d => { if (d.ok) loadLibrary(); });
}

function deleteLibraryFile(tier, filename) {
  if (!confirm(`Remove "${filename}"?`)) return;
  fetch(`/api/library/${tier}/delete/${encodeURIComponent(filename)}`, { method: 'DELETE' })
    .then(r => r.json()).then(d => { if (d.ok) loadLibrary(); });
}

// Upload new file to any tier
['overall','followup1','followup2'].forEach(tier => {
  const fileInput = document.getElementById(`file${tier.charAt(0).toUpperCase()+tier.slice(1)}`);
  const fnameEl   = document.getElementById(`fname${tier.charAt(0).toUpperCase()+tier.slice(1)}`);
  if (fileInput) {
    fileInput.addEventListener('change', e => {
      fnameEl.textContent = e.target.files[0] ? e.target.files[0].name : 'No file chosen';
    });
  }
});

document.querySelectorAll('.lib-upload-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tier   = btn.dataset.tier;
    const cap    = tier.charAt(0).toUpperCase() + tier.slice(1);
    const file   = document.getElementById(`file${cap}`).files[0];
    const label  = document.getElementById(`label${cap}`).value.trim();
    const result = document.getElementById(`result${cap}`);
    if (!file) {
      result.className = 'lib-upload-result err';
      result.textContent = 'Choose a file first';
      result.classList.remove('hidden');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('label', label || file.name);
    fetch(`/api/library/${tier}/upload`, { method: 'POST', body: fd })
      .then(r => r.json())
      .then(d => {
        result.className = 'lib-upload-result ' + (d.ok ? 'ok' : 'err');
        result.textContent = d.ok ? '✓ Uploaded' : '❌ ' + d.error;
        result.classList.remove('hidden');
        if (d.ok) {
          document.getElementById(`file${cap}`).value = '';
          document.getElementById(`fname${cap}`).textContent = 'No file chosen';
          document.getElementById(`label${cap}`).value = '';
          loadLibrary();
        }
        setTimeout(() => result.classList.add('hidden'), 4000);
      });
  });
});

// ── Sent log ───────────────────────────────────────────────────
function loadSentLog() {
  fetch('/api/sent-log').then(r => r.json()).then(data => {
    const tbody = document.getElementById('logBody');
    if (!data.log || !data.log.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No emails sent yet.</td></tr>';
      return;
    }
    tbody.innerHTML = [...data.log].reverse().map(e => `
      <tr>
        <td>${esc(e.sent_at || '')}</td>
        <td>${esc(e.company || '')}</td>
        <td>${esc(e.to_name || '')}</td>
        <td>${esc(e.to_email || '')}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.subject || '')}</td>
        <td>${esc(e.sector || '')}</td>
        <td style="font-size:11px;color:#6e7681">${esc(e.deck || '')}</td>
      </tr>`).join('');
  });
}

// ── Settings ───────────────────────────────────────────────────
function loadSettings() {
  fetch('/api/settings').then(r => r.json()).then(data => {
    if (!data.ok) return;
    const s = data.settings;
    document.getElementById('stAnthropicKey').value = s.anthropic_api_key || '';
    document.getElementById('stHost').value = s.smtp_host || '';
    document.getElementById('stPort').value = s.smtp_port || 587;
    document.getElementById('stUser').value = s.smtp_user || '';
    document.getElementById('stPass').value = s.smtp_pass || '';
    document.getElementById('stName').value = s.sender_name || '';
    if (s.smtp_user) {
      document.getElementById('btnSend').innerHTML = 'Send ✉';
      document.getElementById('btnSend').className = 'btn-send';
    }
  });
}
document.getElementById('btnSaveSettings').addEventListener('click', () => {
  const payload = {
    anthropic_api_key: document.getElementById('stAnthropicKey').value,
    smtp_host:   document.getElementById('stHost').value,
    smtp_port:   parseInt(document.getElementById('stPort').value) || 587,
    smtp_user:   document.getElementById('stUser').value,
    smtp_pass:   document.getElementById('stPass').value,
    sender_name: document.getElementById('stName').value,
  };
  fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  .then(r => r.json())
  .then(data => {
    const el = document.getElementById('settingsResult');
    el.className = 'settings-result ' + (data.ok ? 'ok' : 'err');
    el.textContent = data.ok ? '✓ Settings saved' : '❌ ' + data.error;
    el.classList.remove('hidden');
    if (data.ok && payload.smtp_user) {
      document.getElementById('btnSend').innerHTML = 'Send ✉';
      document.getElementById('btnSend').className = 'btn-send';
    }
    setTimeout(() => el.classList.add('hidden'), 3000);
  });
});

// ── Helpers ────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function flashResult(id, cls, msg) {
  const el = document.getElementById(id);
  el.className = (id === 'readResult' ? 'action-result ' : 'send-result ') + cls;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// Init — reload leads from server if present
fetch('/api/leads').then(r => r.json()).then(data => {
  if (data.ok && data.leads.length) {
    allLeads = data.leads;
    applyFilter();
  }
});
