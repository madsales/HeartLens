'use strict';

// Token support: open the dashboard as /?token=... when DASHBOARD_TOKEN is set.
const TOKEN = new URLSearchParams(location.search).get('token') || '';

const el = (id) => document.getElementById(id);
const state = { platforms: [], selected: new Set(), dryRunOverride: null, status: null };

function log(line) {
  const pre = el('log');
  const stamp = new Date().toLocaleTimeString();
  pre.textContent = `${stamp}  ${line}\n${pre.textContent === 'Waiting…' ? '' : pre.textContent}`;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  if (options.body) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderPlatforms() {
  const host = el('platforms');
  host.innerHTML = '';
  for (const p of state.platforms) {
    const ready = p.configured;
    const wrap = document.createElement('div');
    wrap.className = `platform${ready ? '' : ' off'}`;

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = `pick-${p.id}`;
    box.checked = ready && state.selected.has(p.id);
    box.disabled = !ready;
    box.addEventListener('change', () => {
      if (box.checked) state.selected.add(p.id);
      else state.selected.delete(p.id);
      updateHero();
    });

    const meta = document.createElement('div');
    meta.className = 'meta';

    const name = document.createElement('label');
    name.className = 'name';
    name.htmlFor = box.id;
    name.innerHTML = `${escapeHtml(p.label)}<span class="tier">${escapeHtml(p.tier)}</span>`;
    meta.appendChild(name);

    const state_ = document.createElement('div');
    state_.className = `state${ready ? ' ready' : ''}`;
    const limit = p.limits && p.limits.text ? ` · ${p.limits.text} chars` : '';

    if (p.connected) {
      // Connected through the browser: show who, and when the token lapses.
      const days = p.connected.expiresAt
        ? Math.round((new Date(p.connected.expiresAt) - Date.now()) / 86400000)
        : null;
      const expiry = days === null
        ? 'no expiry'
        : p.connected.refreshable
          ? `auto-renews · ${days}d left`
          : `expires in ${days}d — reconnect needed`;
      state_.innerHTML =
        `<span class="account">${escapeHtml(p.connected.accountName || 'connected')}</span>` +
        `<div class="expiry${!p.connected.refreshable && days !== null && days < 14 ? ' warn' : ''}">${escapeHtml(expiry)}${limit}</div>`;
    } else if (ready) {
      state_.innerHTML = `ready${limit}${p.lastPostedAt ? ` · last ${new Date(p.lastPostedAt).toLocaleString()}` : ''}`;
    } else if ((p.missing || []).length) {
      state_.innerHTML = `needs ${p.missing.map((v) => `<code class="var">${escapeHtml(v)}</code>`).join(' ')}`;
    } else {
      state_.textContent = 'needs setup';
    }
    meta.appendChild(state_);

    if (p.needsReview && !p.connected) {
      const tag = document.createElement('div');
      tag.className = 'needs-review';
      tag.textContent = 'app review required';
      meta.appendChild(tag);
    }

    // Connect / disconnect controls.
    const actions = document.createElement('div');
    actions.className = 'row-actions';

    if (p.connectable && !p.connected) {
      const btn = document.createElement('button');
      btn.className = 'connect';
      btn.type = 'button';
      btn.textContent = 'Connect';
      if (!p.appCredsSet) {
        btn.disabled = true;
        btn.title = `Set ${(p.appCredsEnv || []).join(' and ')} in .env first`;
        const hint = document.createElement('div');
        hint.className = 'setup-hint';
        hint.innerHTML = `Set ${(p.appCredsEnv || []).map((v) => `<code class="var">${escapeHtml(v)}</code>`).join(' ')} in .env first.` +
          (p.setup ? `<br>${escapeHtml(p.setup)}` : '');
        meta.appendChild(hint);
      } else {
        btn.addEventListener('click', () => startConnect(p));
      }
      actions.appendChild(btn);
    }

    if (p.connected) {
      const btn = document.createElement('button');
      btn.className = 'unlink';
      btn.type = 'button';
      btn.textContent = 'Disconnect';
      btn.addEventListener('click', async () => {
        if (!confirm(`Disconnect ${p.label}? You can reconnect at any time.`)) return;
        try {
          await api('/api/disconnect', { method: 'POST', body: JSON.stringify({ platform: p.id }) });
          log(`${p.label} disconnected.`);
          refresh();
        } catch (err) { log(`Disconnect failed: ${err.message}`); }
      });
      actions.appendChild(btn);
    }

    if (actions.children.length) meta.appendChild(actions);

    wrap.append(box, meta);
    host.appendChild(wrap);
  }
  el('platform-count').textContent = `${state.platforms.filter((p) => p.configured).length} ready of ${state.platforms.length}`;
}

// Opens the platform's own login in a new tab, then polls until the callback
// lands. Same flow Buffer uses -- the difference is the app is yours.
async function startConnect(platform) {
  log(`Opening ${platform.label} login…`);
  try {
    const out = await api('/api/connect', { method: 'POST', body: JSON.stringify({ platform: platform.id }) });

    // window.open returns null whenever 'noopener' is set -- that is the spec,
    // not a blocked popup -- so the return value says nothing useful. Always
    // offer the URL as a fallback and always start polling.
    window.open(out.authUrl, '_blank', 'noopener');
    showConnectFallback(platform, out.authUrl);
    if (out.needsReview) {
      log(`Note: ${platform.label} needs platform app review before posts from a normal account go live.`);
    }

    // Poll for up to five minutes; the user is logging in on another tab.
    const deadline = Date.now() + 300000;
    const poll = setInterval(async () => {
      try {
        const st = await api(`/api/connect/status?platform=${encodeURIComponent(platform.id)}`);
        if (st.connected) {
          clearInterval(poll);
          clearConnectFallback();
          log(`${platform.label} connected${st.accountName ? ` as ${st.accountName}` : ''}.`);
          refresh();
        } else if (!st.pending || Date.now() > deadline) {
          clearInterval(poll);
          clearConnectFallback();
          log(`${platform.label} was not connected. Check the terminal for the reason.`);
          refresh();
        }
      } catch {
        clearInterval(poll);
      }
    }, 2000);
  } catch (err) {
    log(`Connect failed: ${err.message}`);
  }
}

function renderQueue(posts) {
  const host = el('queue');
  const pending = posts.filter((p) => p.status === 'queued');
  el('queue-count').textContent = pending.length ? `${pending.length} waiting` : '';
  if (!pending.length) {
    host.innerHTML = '<p class="empty">Nothing queued. A scheduled run will fall back to the content pack.</p>';
    return;
  }
  host.innerHTML = '';
  for (const post of pending) {
    const row = document.createElement('div');
    row.className = 'queue-item';
    row.innerHTML =
      `<div class="body">` +
      `<div class="when">${post.scheduledAt ? new Date(post.scheduledAt).toLocaleString() : 'next scheduled run'}` +
      `${post.platforms ? ` · ${escapeHtml(post.platforms.join(', '))}` : ''}</div>` +
      `<p>${escapeHtml(String(post.text).slice(0, 180))}${post.text.length > 180 ? '…' : ''}</p>` +
      `</div>`;
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = 'Remove';
    del.addEventListener('click', async () => {
      try {
        await api('/api/queue/delete', { method: 'POST', body: JSON.stringify({ id: post.id }) });
        log(`Removed queued post ${post.id.slice(0, 8)}`);
        refresh();
      } catch (err) { log(`Remove failed: ${err.message}`); }
    });
    row.appendChild(del);
    host.appendChild(row);
  }
}

function renderResults(result) {
  const host = el('results');
  const rows = result?.results || [];
  if (!rows.length) {
    host.innerHTML = `<p class="empty">${escapeHtml(result?.reason ? `Skipped: ${result.reason}` : 'Nothing sent.')}</p>`;
    return;
  }
  host.innerHTML = '';
  for (const r of rows) {
    const div = document.createElement('div');
    div.className = 'result';
    const cls = r.skipped ? 'skip' : r.ok ? 'ok' : 'err';
    const mark = r.skipped ? '○' : r.ok ? '●' : '✕';
    let what;
    if (r.skipped) what = escapeHtml(r.reason || 'skipped');
    else if (r.dryRun) what = `dry run · ${r.chars}${r.limit ? `/${r.limit}` : ''} chars${r.wouldTruncate ? ' · would be trimmed' : ''}`;
    else if (r.ok) what = r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a>` : 'published';
    else what = escapeHtml(r.error || 'failed');
    div.innerHTML = `<span class="dot ${cls}">${mark}</span><span class="who">${escapeHtml(r.platform)}</span><span class="what">${what}</span>`;
    host.appendChild(div);
  }
}

function updateHero() {
  const s = state.status;
  if (!s) return;
  const chosen = state.selected.size;
  const dry = state.dryRunOverride ?? s.dryRun;
  const hasText = el('text').value.trim().length > 0;
  el('big-post-sub').textContent =
    `${dry ? 'Dry run — nothing is actually sent' : 'LIVE'} · ${chosen} platform${chosen === 1 ? '' : 's'} · ${
      hasText ? 'your text' : `content pack item ${(s.pack?.nextIndex ?? 0) + 1}/${s.pack?.total ?? 0}`
    }`;
  el('big-post').disabled = chosen === 0;
  el('toggle-dry').textContent = dry ? 'Switch to a real send' : 'Preview instead (dry run)';
  el('hero-hint').textContent =
    chosen === 0
      ? 'No platform selected. Tick at least one below, or add credentials and refresh.'
      : s.dryRun && state.dryRunOverride !== false
        ? 'DRY_RUN is on in .env, so posts are previewed rather than sent. Set DRY_RUN=false when you are ready to go live.'
        : '';
}

async function refresh() {
  try {
    const [status, queue] = await Promise.all([api('/api/status'), api('/api/queue')]);
    state.status = status;
    state.platforms = status.platforms;
    // On first load, select everything that is ready.
    if (!state.initialised) {
      status.platforms.filter((p) => p.configured).forEach((p) => state.selected.add(p.id));
      state.initialised = true;
    } else {
      for (const id of [...state.selected]) {
        if (!status.platforms.find((p) => p.id === id && p.configured)) state.selected.delete(id);
      }
    }

    el('mode-badge').textContent = status.dryRun ? 'dry run' : 'live';
    el('mode-badge').className = `badge ${status.dryRun ? 'dry' : 'live'}`;
    el('ready-badge').textContent = `${status.readyCount} platform${status.readyCount === 1 ? '' : 's'} ready`;
    const sched = status.schedule || {};
    el('foot-schedule').textContent = sched.source || sched.error || '—';
    const nextRun = Array.isArray(sched.next) ? sched.next[0] : sched.next;
    el('foot-next').textContent = nextRun ? new Date(nextRun).toLocaleString() : '—';
    if (sched.mode === 'slots' && sched.summary) el('foot-schedule').title = sched.summary;
    if (!el('link').value) el('link').value = status.siteUrl || '';

    renderPlatforms();
    renderQueue(queue.posts);
    updateHero();
  } catch (err) {
    log(`Status failed: ${err.message}`);
  }
}

function composePayload() {
  const text = el('text').value.trim();
  const media = el('media').value.split(',').map((s) => s.trim()).filter(Boolean);
  const payload = { platforms: [...state.selected] };
  if (text) payload.text = text;
  if (el('title').value.trim()) payload.title = el('title').value.trim();
  if (el('link').value.trim()) payload.link = el('link').value.trim();
  if (media.length) payload.media = media;
  return payload;
}

// ---- the one click -------------------------------------------------------

el('big-post').addEventListener('click', async () => {
  const btn = el('big-post');
  btn.disabled = true;
  const dry = state.dryRunOverride ?? state.status?.dryRun;
  log(`${dry ? 'Previewing' : 'Posting'} to: ${[...state.selected].join(', ')}`);
  try {
    const payload = composePayload();
    if (state.dryRunOverride !== null) payload.dryRun = state.dryRunOverride;
    const out = await api('/api/post-now', { method: 'POST', body: JSON.stringify(payload) });
    renderResults(out.result);
    const r = out.result;
    log(r.skipped ? `Skipped: ${r.reason}` : `${r.delivered} delivered, ${r.failed} failed${r.dryRun ? ' (dry run)' : ''}`);
    if (!r.skipped && !r.dryRun && r.anySuccess) el('text').value = '';
    refresh();
  } catch (err) {
    log(`Post failed: ${err.message}`);
    renderResults({ results: [{ platform: 'dashboard', ok: false, error: err.message }] });
  } finally {
    btn.disabled = false;
    updateHero();
  }
});

function showConnectFallback(platform, authUrl) {
  const hint = el('hero-hint');
  hint.innerHTML =
    `Finishing the ${escapeHtml(platform.label)} login in the other tab… ` +
    `<a href="${escapeHtml(authUrl)}" target="_blank" rel="noopener">open it again</a> if nothing happened.`;
}

function clearConnectFallback() {
  el('hero-hint').textContent = '';
  updateHero();
}

el('toggle-dry').addEventListener('click', () => {
  const current = state.dryRunOverride ?? state.status?.dryRun ?? true;
  state.dryRunOverride = !current;
  updateHero();
  log(`Next send: ${state.dryRunOverride ? 'dry run' : 'LIVE'}`);
});

el('run-schedule').addEventListener('click', async () => {
  log('Running the scheduled job now…');
  try {
    const out = await api('/api/run-now', { method: 'POST' });
    const runs = out.result?.runs || [];
    if (runs.length) renderResults(runs[runs.length - 1]);
    log(`Scheduled job finished (${runs.length} post${runs.length === 1 ? '' : 's'}).`);
    refresh();
  } catch (err) { log(`Run failed: ${err.message}`); }
});

el('queue-btn').addEventListener('click', async () => {
  const payload = composePayload();
  if (!payload.text) { log('Add some text before queueing.'); return; }
  if (el('when').value) payload.scheduledAt = new Date(el('when').value).toISOString();
  try {
    await api('/api/queue', { method: 'POST', body: JSON.stringify(payload) });
    log(`Queued${payload.scheduledAt ? ` for ${new Date(payload.scheduledAt).toLocaleString()}` : ''}.`);
    el('text').value = '';
    el('title').value = '';
    refresh();
  } catch (err) { log(`Queue failed: ${err.message}`); }
});

el('fill-pack').addEventListener('click', async () => {
  try {
    const out = await api('/api/queue/fill-from-pack', { method: 'POST', body: JSON.stringify({}) });
    log(`Queued ${out.added} posts from the content pack.`);
    refresh();
  } catch (err) { log(`Fill failed: ${err.message}`); }
});

el('refresh').addEventListener('click', refresh);

el('text').addEventListener('input', () => {
  const len = el('text').value.length;
  const tightest = state.platforms
    .filter((p) => p.configured && state.selected.has(p.id) && p.limits?.text)
    .sort((a, b) => a.limits.text - b.limits.text)[0];
  el('chars').textContent = tightest
    ? `${len} chars · tightest limit is ${tightest.label} at ${tightest.limits.text}${len > tightest.limits.text ? ' — will be split or trimmed' : ''}`
    : `${len} chars`;
  updateHero();
});

refresh();
setInterval(refresh, 30000);
