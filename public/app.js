(() => {
  'use strict';

  const deckEl = document.getElementById('deck');
  const actionsRowEl = document.getElementById('actionsRow');
  const organizeRowEl = document.getElementById('organizeRow');
  const detailsSheetEl = document.getElementById('detailsSheet');
  const detailsListEl = document.getElementById('detailsList');
  const detailsStatusEl = document.getElementById('detailsStatus');
  const detailsCopyPathBtn = document.getElementById('detailsCopyPath');
  const detailsRevealBtn = document.getElementById('detailsReveal');
  const detailsCloseBtn = document.getElementById('detailsClose');
  const detailsBackdrop = document.getElementById('detailsBackdrop');
  const detailsLink = document.getElementById('detailsLink');
  const progressFillEl = document.getElementById('progressFill');
  const statsLineEl = document.getElementById('statsLine');
  const sourceLabelEl = document.getElementById('sourceLabel');
  const rescanLink = document.getElementById('rescanLink');
  const emptyTrashLink = document.getElementById('emptyTrashLink');
  const shortcutsLink = document.getElementById('shortcutsLink');
  const shortcutsModal = document.getElementById('shortcutsModal');
  const shortcutsClose = document.getElementById('shortcutsClose');
  const shortcutListEl = document.getElementById('shortcutList');
  const liveRegionEl = document.getElementById('liveRegion');

  const DRAG_THRESHOLD = 110;
  let state = null; // last /api/queue payload
  let dragging = null;
  let busy = false;
  let focusBeforeModal = null;
  let detailsOpen = false;
  let detailsDismissed = false;
  let detailsForId = null;
  let detailsCache = null;

  const KEY_LABEL = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ' ': 'Space',
  };

  const KEY_SPOKEN = {
    ArrowLeft: 'left arrow',
    ArrowRight: 'right arrow',
    ArrowUp: 'up arrow',
    ArrowDown: 'down arrow',
    ' ': 'space',
  };

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed: ${res.status}`);
    return body;
  }

  function fmtMeta(meta) {
    if (!meta) return [];
    return Object.entries(meta).map(([key, value]) => `${key}: ${value}`);
  }

  function keyGlyph(key) {
    return KEY_LABEL[key] || key;
  }

  function keySpoken(key) {
    return KEY_SPOKEN[key] || key;
  }

  function announce(message) {
    liveRegionEl.textContent = '';
    // re-trigger even if the text is identical to the last announcement
    window.requestAnimationFrame(() => {
      liveRegionEl.textContent = message;
    });
  }

  function renderPreview(item) {
    const wrap = document.createElement('div');
    wrap.className = 'preview';
    const src = `/api/preview/${item.id}`;
    const thumbSrc = `/api/thumbnail/${item.id}`;
    switch (item.previewType) {
      case 'image': {
        const img = document.createElement('img');
        img.src = thumbSrc;
        img.alt = item.title;
        img.draggable = false;
        img.addEventListener(
          'error',
          () => {
            if (img.src.endsWith(thumbSrc)) {
              img.src = src; // fall back to the full file if a thumbnail couldn't be made
              return;
            }
            wrap.classList.add('file-icon');
            wrap.textContent = 'preview failed\n(jpg/png/webp work everywhere; HEIC/RAW need macOS Quick Look)';
            wrap.style.fontSize = '12px';
            wrap.style.color = 'var(--sub)';
            wrap.style.whiteSpace = 'pre-line';
            wrap.style.padding = '24px';
          },
          { once: false }
        );
        wrap.appendChild(img);
        break;
      }
      case 'pdf': {
        // First-page Quick Look thumb when available; otherwise in-browser PDF.
        const img = document.createElement('img');
        img.src = thumbSrc;
        img.alt = item.title;
        img.draggable = false;
        const badge = document.createElement('div');
        badge.className = 'preview-badge';
        badge.textContent = 'PDF';
        wrap.appendChild(badge);
        img.addEventListener(
          'error',
          () => {
            img.remove();
            const frame = document.createElement('iframe');
            frame.className = 'pdf-frame';
            frame.src = src;
            frame.title = item.title;
            wrap.appendChild(frame);
          },
          { once: true }
        );
        wrap.appendChild(img);
        break;
      }
      case 'archive': {
        const pre = document.createElement('pre');
        pre.className = 'archive-listing';
        pre.textContent = 'Listing archive…';
        wrap.appendChild(pre);
        const badge = document.createElement('div');
        badge.className = 'preview-badge';
        badge.textContent = 'ZIP';
        wrap.appendChild(badge);
        fetch(src)
          .then((r) => r.text())
          .then((text) => {
            pre.textContent = text.slice(0, 4000);
          })
          .catch(() => {
            pre.textContent = '(could not list archive)';
          });
        break;
      }
      case 'audio': {
        // Custom seek UI (native <audio controls> scrubber fights card swipe /
        // shadow-DOM hit targets and often jumps back to 0:00).
        const audio = document.createElement('audio');
        audio.preload = 'auto';
        wrap.classList.add('audio-preview');
        wrap.style.padding = '24px 16px';
        wrap.style.width = '100%';
        wrap.style.boxSizing = 'border-box';

        const status = document.createElement('div');
        status.className = 'audio-status';
        status.textContent = 'Loading audio…';

        const timeLabel = document.createElement('div');
        timeLabel.className = 'audio-time';
        timeLabel.textContent = '0:00 / ?:??';

        const seek = document.createElement('input');
        seek.type = 'range';
        seek.min = '0';
        seek.max = '1000';
        seek.value = '0';
        seek.step = '1';
        seek.disabled = true;
        seek.setAttribute('aria-label', 'Seek');
        seek.className = 'audio-seek';

        const btnRow = document.createElement('div');
        btnRow.className = 'audio-btns';
        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.textContent = 'Play';
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.textContent = '−10s';
        const fwdBtn = document.createElement('button');
        fwdBtn.type = 'button';
        fwdBtn.textContent = '+10s';
        for (const b of [backBtn, playBtn, fwdBtn]) btnRow.appendChild(b);

        wrap.appendChild(status);
        wrap.appendChild(timeLabel);
        wrap.appendChild(seek);
        wrap.appendChild(btnRow);
        wrap.appendChild(audio);

        // Never let card-swipe steal pointer events from the player.
        for (const evt of ['pointerdown', 'pointermove', 'pointerup', 'click', 'touchstart']) {
          wrap.addEventListener(evt, (e) => e.stopPropagation());
        }

        const fmt = (sec) => {
          if (!Number.isFinite(sec) || sec < 0) return '?:??';
          const s = Math.floor(sec);
          return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        };

        let objectUrl = null;
        let scrubbing = false;
        const revoke = () => {
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
          }
        };
        const obs = new MutationObserver(() => {
          if (!document.body.contains(wrap)) {
            revoke();
            obs.disconnect();
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });

        const syncLabel = () => {
          timeLabel.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
        };

        seek.addEventListener('pointerdown', () => {
          scrubbing = true;
        });
        seek.addEventListener('pointerup', () => {
          scrubbing = false;
        });
        seek.addEventListener('input', () => {
          if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
          audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
          syncLabel();
        });
        audio.addEventListener('timeupdate', () => {
          if (scrubbing) return;
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
          }
          syncLabel();
          playBtn.textContent = audio.paused ? 'Play' : 'Pause';
        });
        audio.addEventListener('loadedmetadata', () => {
          seek.disabled = !Number.isFinite(audio.duration);
          syncLabel();
        });

        playBtn.addEventListener('click', () => {
          if (audio.paused) audio.play().catch(() => {});
          else audio.pause();
        });
        backBtn.addEventListener('click', () => {
          audio.currentTime = Math.max(0, audio.currentTime - 10);
        });
        fwdBtn.addEventListener('click', () => {
          if (Number.isFinite(audio.duration)) {
            audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
          }
        });

        fetch(src)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer().then((buf) => {
              const type = r.headers.get('content-type') || 'audio/mpeg';
              return new Blob([buf], { type });
            });
          })
          .then((blob) => {
            if (!document.body.contains(wrap)) return;
            revoke();
            objectUrl = URL.createObjectURL(blob);
            audio.src = objectUrl;
            status.remove();
            return audio.play().catch(() => {});
          })
          .catch((err) => {
            status.textContent = `Could not load audio (${err.message || err})`;
          });
        break;
      }
      case 'video': {
        const video = document.createElement('video');
        video.controls = true;
        video.autoplay = true;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.poster = thumbSrc;
        video.src = src;
        wrap.appendChild(video);
        break;
      }
      case 'text': {
        const pre = document.createElement('pre');
        pre.textContent = 'Loading preview...';
        wrap.appendChild(pre);
        fetch(src)
          .then((r) => r.text())
          .then((text) => {
            pre.textContent = text.slice(0, 2000);
          })
          .catch(() => {
            pre.textContent = '(preview unavailable)';
          });
        break;
      }
      default: {
        wrap.classList.add('file-icon');
        wrap.setAttribute('aria-hidden', 'true');
        wrap.textContent = '\u{1F4C4}';
      }
    }
    return wrap;
  }

  function renderCard(item, actions, position) {
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `${position.index} of ${position.total}: ${item.title}`);
    card.appendChild(renderPreview(item));

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title;
    title.title = 'Click for details (or press i)';
    title.style.cursor = 'pointer';
    title.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDetails();
    });
    card.appendChild(title);

    if (item.subtitle) {
      const subtitle = document.createElement('div');
      subtitle.className = 'subtitle';
      subtitle.textContent = item.subtitle;
      card.appendChild(subtitle);
    }

    const metaEntries = fmtMeta(item.meta);
    if (metaEntries.length) {
      const row = document.createElement('div');
      row.className = 'meta-row';
      for (const entry of metaEntries) {
        const badge = document.createElement('span');
        badge.className = 'meta-badge';
        badge.textContent = entry;
        row.appendChild(badge);
      }
      card.appendChild(row);
    }

    for (const dir of ['left', 'right']) {
      const action = actions.find((a) => a.direction === dir);
      if (!action) continue;
      const stamp = document.createElement('div');
      stamp.className = `stamp ${dir}`;
      stamp.dataset.direction = dir;
      stamp.textContent = action.label;
      stamp.setAttribute('aria-hidden', 'true');
      card.appendChild(stamp);
    }

    // Audio/video: no card-swipe drag — it steals seek/scrub gestures.
    if (item.previewType !== 'audio' && item.previewType !== 'video') {
      attachDrag(card, actions);
    }
    return card;
  }

  function attachDrag(card, actions) {
    const leftAction = actions.find((a) => a.direction === 'left');
    const rightAction = actions.find((a) => a.direction === 'right');
    const leftStamp = card.querySelector('.stamp.left');
    const rightStamp = card.querySelector('.stamp.right');

    function onPointerDown(e) {
      if (busy) return;
      if (e.target.closest('audio, video, input, textarea, select, button, a, .preview')) return;
      dragging = { startX: e.clientX, startY: e.clientY, dx: 0 };
      card.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
      if (!dragging) return;
      dragging.dx = e.clientX - dragging.startX;
      const dy = (e.clientY - dragging.startY) * 0.2;
      const rotate = dragging.dx / 18;
      card.style.transform = `translate(${dragging.dx}px, ${dy}px) rotate(${rotate}deg)`;
      const ratio = Math.min(Math.abs(dragging.dx) / DRAG_THRESHOLD, 1);
      if (dragging.dx > 0 && rightStamp) rightStamp.style.opacity = String(ratio);
      if (dragging.dx < 0 && leftStamp) leftStamp.style.opacity = String(ratio);
    }

    function onPointerUp() {
      if (!dragging) return;
      const dx = dragging.dx;
      dragging = null;
      if (dx > DRAG_THRESHOLD && rightAction) {
        animateAction(rightAction);
      } else if (dx < -DRAG_THRESHOLD && leftAction) {
        animateAction(leftAction);
      } else {
        card.style.transform = '';
        if (leftStamp) leftStamp.style.opacity = '0';
        if (rightStamp) rightStamp.style.opacity = '0';
      }
    }

    card.addEventListener('pointerdown', onPointerDown);
    card.addEventListener('pointermove', onPointerMove);
    card.addEventListener('pointerup', onPointerUp);
    card.addEventListener('pointercancel', onPointerUp);
  }

  /** Show KEEP/REJECT/organize stamp + fling, then commit the action. */
  function animateAction(action) {
    if (busy || !state || !state.current) return;
    const card = deckEl.querySelector('.card');
    if (!card) {
      performAction(action.id);
      return;
    }

    const dir = action.direction === 'right' ? 1 : action.direction === 'left' ? -1 : 0;
    if (action.direction === 'left' || action.direction === 'right') {
      const stamp = card.querySelector(`.stamp.${action.direction}`);
      if (stamp) stamp.style.opacity = '1';
    } else if (action.group === 'organize') {
      let stamp = card.querySelector('.stamp.center');
      if (!stamp) {
        stamp = document.createElement('div');
        stamp.className = 'stamp center';
        stamp.setAttribute('aria-hidden', 'true');
        card.appendChild(stamp);
      }
      stamp.textContent = action.label;
      stamp.style.opacity = '1';
    }

    if (dir === 0 && action.group !== 'organize') {
      performAction(action.id);
      return;
    }

    busy = true;
    card.style.transition = 'transform 0.28s ease-out, opacity 0.28s ease-out';
    if (dir !== 0) {
      card.style.transform = `translate(${dir * 500}px, -40px) rotate(${dir * 25}deg)`;
    } else {
      card.style.transform = 'translate(0, -120px) scale(0.92)';
    }
    card.style.opacity = '0';
    setTimeout(() => {
      busy = false;
      performAction(action.id);
    }, 220);
  }

  function triggerAction(actionId) {
    if (busy || !state) return;
    const action = (state.actions || []).find((a) => a.id === actionId);
    if (!action) return;
    if (action.direction === 'left' || action.direction === 'right' || action.group === 'organize') {
      animateAction(action);
    } else {
      performAction(actionId);
    }
  }

  function makeActionButton(action, className) {
    const btn = document.createElement('button');
    btn.className = className;
    btn.type = 'button';
    btn.title = action.destPath ? `${action.label}\n${action.destPath}` : action.label;
    btn.setAttribute('aria-label', `${action.label}, ${keySpoken(action.key)}`);
    if (action.id === 'keep') btn.classList.add('keep');
    if (action.isDestructive) btn.classList.add('reject');
    if (action.id === 'skip') btn.classList.add('skip');

    const label = document.createElement('span');
    label.className = 'action-label';
    label.textContent = action.label;
    label.setAttribute('aria-hidden', 'true');

    const key = document.createElement('span');
    key.className = 'action-key';
    key.textContent = keyGlyph(action.key);
    key.setAttribute('aria-hidden', 'true');

    btn.appendChild(label);
    btn.appendChild(key);
    btn.addEventListener('click', () => triggerAction(action.id));
    return btn;
  }

  function hideDetailsPanel() {
    detailsSheetEl.hidden = true;
    detailsSheetEl.setAttribute('aria-hidden', 'true');
    detailsListEl.innerHTML = '';
    detailsStatusEl.textContent = '';
    detailsCopyPathBtn.hidden = true;
    detailsRevealBtn.hidden = true;
    detailsForId = null;
    detailsCache = null;
  }

  function renderDetailsFields(details) {
    detailsListEl.innerHTML = '';
    for (const field of details.fields || []) {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = field.label;
      const dd = document.createElement('dd');
      dd.textContent = field.value;
      row.appendChild(dt);
      row.appendChild(dd);
      detailsListEl.appendChild(row);
    }
    const canReveal = (details.actions || []).some((a) => a.id === 'reveal');
    detailsRevealBtn.hidden = !canReveal;
    detailsCopyPathBtn.hidden = !details.path;
    detailsCache = details;
  }

  async function loadDetails(itemId, { force } = {}) {
    if (!itemId) return;
    if (!force && detailsForId === itemId && detailsCache) {
      renderDetailsFields(detailsCache);
      return;
    }
    detailsForId = itemId;
    detailsStatusEl.textContent = 'Loading…';
    detailsListEl.innerHTML = '';
    detailsCopyPathBtn.hidden = true;
    detailsRevealBtn.hidden = true;
    try {
      const details = await api(`/api/details/${encodeURIComponent(itemId)}`);
      if (detailsForId !== itemId) return;
      detailsStatusEl.textContent = '';
      renderDetailsFields(details);
    } catch (err) {
      if (detailsForId !== itemId) return;
      detailsStatusEl.textContent = err.message;
    }
  }

  async function showDetailsPanel() {
    if (!state || !state.current) return;
    if (state.ui && state.ui.supportsDetails === false) {
      announce('Details are not available for this adapter.');
      return;
    }
    detailsOpen = true;
    detailsDismissed = false;
    detailsSheetEl.hidden = false;
    detailsSheetEl.setAttribute('aria-hidden', 'false');
    await loadDetails(state.current.id);
    detailsCloseBtn.focus();
    announce('File details shown. Press i to hide.');
  }

  function closeDetailsPanel({ silent } = {}) {
    detailsOpen = false;
    detailsDismissed = true;
    hideDetailsPanel();
    if (!silent) announce('File details hidden.');
  }

  async function toggleDetails() {
    if (detailsOpen) closeDetailsPanel();
    else await showDetailsPanel();
  }

  function renderActionsRow(actions) {
    actionsRowEl.innerHTML = '';
    organizeRowEl.innerHTML = '';

    const primary = (actions || []).filter((a) => a.group !== 'organize');
    const organize = (actions || []).filter((a) => a.group === 'organize');

    for (const action of primary) {
      actionsRowEl.appendChild(makeActionButton(action, 'action-btn'));
    }

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'action-btn undo';
    undoBtn.disabled = !state || !state.canUndo;
    undoBtn.setAttribute('aria-label', 'Undo, up arrow');
    const undoLabel = document.createElement('span');
    undoLabel.className = 'action-label';
    undoLabel.textContent = 'Undo';
    undoLabel.setAttribute('aria-hidden', 'true');
    const undoKey = document.createElement('span');
    undoKey.className = 'action-key';
    undoKey.textContent = '↑';
    undoKey.setAttribute('aria-hidden', 'true');
    undoBtn.appendChild(undoLabel);
    undoBtn.appendChild(undoKey);
    undoBtn.addEventListener('click', undo);
    actionsRowEl.appendChild(undoBtn);

    if (organize.length) {
      organizeRowEl.hidden = false;
      for (const action of organize) {
        organizeRowEl.appendChild(makeActionButton(action, 'organize-btn'));
      }
    } else {
      organizeRowEl.hidden = true;
    }

    if (detailsLink) {
      detailsLink.disabled = !state || !state.current;
      detailsLink.hidden = Boolean(state && state.ui && state.ui.supportsDetails === false);
    }

    updateShortcutList(organize);
  }

  function updateShortcutList(organizeActions) {
    if (!shortcutListEl) return;
    shortcutListEl.querySelectorAll('[data-organize-shortcut]').forEach((el) => el.remove());
    for (const action of organizeActions || []) {
      const row = document.createElement('div');
      row.dataset.organizeShortcut = '1';
      row.innerHTML = `<dt>${action.key}</dt><dd>Move to ${action.label}</dd>`;
      shortcutListEl.appendChild(row);
    }
  }

  function renderStats() {
    if (!state) return;
    const pct = state.total ? Math.round((state.reviewed / state.total) * 100) : 0;
    progressFillEl.style.width = `${pct}%`;
    progressFillEl.setAttribute('aria-valuemax', String(state.total));
    progressFillEl.setAttribute('aria-valuenow', String(state.reviewed));
    sourceLabelEl.textContent = state.sourceLabel || '';
    const labels = Object.fromEntries((state.actions || []).map((a) => [a.id, a.label]));
    const countBits = Object.entries(state.counts || {})
      .map(([id, n]) => `${labels[id] || id}: ${n}`)
      .join(' \u00b7 ');
    statsLineEl.textContent = `${state.reviewed}/${state.total} reviewed${countBits ? '  \u2014  ' + countBits : ''}`;

    if (state.trashInfo && state.trashInfo.count > 0) {
      emptyTrashLink.hidden = false;
      emptyTrashLink.textContent = `Empty trash (${state.trashInfo.count})`;
    } else {
      emptyTrashLink.hidden = true;
    }
  }

  function renderDeck() {
    deckEl.innerHTML = '';
    if (!state) return;
    if (!state.current) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const labels = Object.fromEntries((state.actions || []).map((a) => [a.id, a.label]));
      const countBits = Object.entries(state.counts || {})
        .map(([id, n]) => `<strong>${n}</strong> ${labels[id] || id}`)
        .join(' &nbsp;&nbsp; ');
      empty.innerHTML = `All done. ${state.total} item(s) reviewed.<div class="summary">${countBits}</div>`;
      deckEl.appendChild(empty);
      renderActionsRow([]);
      closeDetailsPanel({ silent: true });
      announce(`All done. ${state.total} items reviewed.`);
      return;
    }
    const position = { index: state.reviewed + 1, total: state.total };
    const card = renderCard(state.current, state.actions, position);
    deckEl.appendChild(card);
    renderActionsRow(state.actions);
    announce(`Item ${position.index} of ${position.total}: ${state.current.title}`);

    const wantDetails =
      detailsOpen || ((state.ui && state.ui.showDetailsByDefault) && !detailsDismissed);
    if (wantDetails) {
      detailsOpen = true;
      detailsSheetEl.hidden = false;
      detailsSheetEl.setAttribute('aria-hidden', 'false');
      loadDetails(state.current.id);
    } else if (!detailsOpen) {
      hideDetailsPanel();
    }
  }

  function render() {
    renderStats();
    renderDeck();
  }

  function showError(message) {
    deckEl.innerHTML = `<div class="error-state" role="alert">${message}</div>`;
  }

  function getFocusable(container) {
    return Array.from(
      container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.disabled && el.offsetParent !== null);
  }

  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const focusable = getFocusable(shortcutsModal);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function openShortcuts() {
    focusBeforeModal = document.activeElement;
    shortcutsModal.hidden = false;
    shortcutsModal.setAttribute('aria-hidden', 'false');
    shortcutsModal.addEventListener('keydown', trapFocus);
    shortcutsClose.focus();
  }

  function closeShortcuts() {
    shortcutsModal.hidden = true;
    shortcutsModal.setAttribute('aria-hidden', 'true');
    shortcutsModal.removeEventListener('keydown', trapFocus);
    if (focusBeforeModal && typeof focusBeforeModal.focus === 'function') {
      focusBeforeModal.focus();
    }
    focusBeforeModal = null;
  }

  function toggleShortcuts() {
    if (shortcutsModal.hidden) openShortcuts();
    else closeShortcuts();
  }

  async function refresh() {
    try {
      state = await api('/api/queue');
      render();
    } catch (err) {
      if (String(err.message).includes('Not configured')) {
        window.location.href = 'settings.html';
        return;
      }
      showError(err.message);
    }
  }

  async function performAction(actionId) {
    if (!state || !state.current) return;
    const itemId = state.current.id;
    try {
      state = await api('/api/action', { method: 'POST', body: JSON.stringify({ itemId, actionId }) });
      render();
    } catch (err) {
      showError(err.message);
      setTimeout(refresh, 800);
    }
  }

  async function undo() {
    if (busy) return;
    try {
      state = await api('/api/undo', { method: 'POST' });
      render();
    } catch (err) {
      showError(err.message);
    }
  }

  rescanLink.addEventListener('click', async () => {
    try {
      state = await api('/api/rescan', { method: 'POST' });
      render();
    } catch (err) {
      showError(err.message);
    }
  });

  emptyTrashLink.addEventListener('click', async () => {
    const count = state && state.trashInfo ? state.trashInfo.count : 0;
    const ok = window.confirm(
      `Permanently delete ${count} item(s) from trash? This cannot be undone.`
    );
    if (!ok) return;
    try {
      state = await api('/api/empty-trash', { method: 'POST' });
      render();
      announce('Trash emptied.');
    } catch (err) {
      showError(err.message);
    }
  });

  shortcutsLink.addEventListener('click', () => {
    toggleShortcuts();
  });
  shortcutsClose.addEventListener('click', closeShortcuts);
  shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) closeShortcuts();
  });

  detailsCloseBtn.addEventListener('click', () => closeDetailsPanel());
  detailsBackdrop.addEventListener('click', () => closeDetailsPanel());
  if (detailsLink) {
    detailsLink.addEventListener('click', () => toggleDetails());
  }
  detailsCopyPathBtn.addEventListener('click', async () => {
    if (!detailsCache || !detailsCache.path) return;
    try {
      await navigator.clipboard.writeText(detailsCache.path);
      detailsStatusEl.textContent = 'Path copied.';
      announce('Path copied to clipboard.');
    } catch (err) {
      detailsStatusEl.textContent = err.message || 'Could not copy path.';
    }
  });
  detailsRevealBtn.addEventListener('click', async () => {
    if (!state || !state.current) return;
    try {
      await api(`/api/reveal/${encodeURIComponent(state.current.id)}`, { method: 'POST' });
      detailsStatusEl.textContent = 'Revealed in Finder.';
    } catch (err) {
      detailsStatusEl.textContent = err.message;
    }
  });

  document.addEventListener('keydown', (e) => {
    // Shift+? (Shift+/ on most keyboards) toggles shortcuts help
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      toggleShortcuts();
      return;
    }
    if (e.key === 'Escape' && !shortcutsModal.hidden) {
      e.preventDefault();
      closeShortcuts();
      return;
    }
    if (e.key === 'Escape' && detailsOpen) {
      e.preventDefault();
      closeDetailsPanel();
      return;
    }
    if (!shortcutsModal.hidden) return;
    if (!state) return;

    if (e.key === 'ArrowUp' || ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      undo();
      return;
    }

    if ((e.key === 'i' || e.key === 'I') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      toggleDetails();
      return;
    }

    if (!state.current || busy) return;

    // Space is an alias for Skip even if Skip's declared key is ↓.
    if (e.key === ' ') {
      e.preventDefault();
      triggerAction('skip');
      return;
    }

    const action = (state.actions || []).find((a) => a.key === e.key);
    if (action) {
      e.preventDefault();
      triggerAction(action.id);
    }
  });

  refresh();
})();
