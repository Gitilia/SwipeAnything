(() => {
  'use strict';

  const deckEl = document.getElementById('deck');
  const actionsRowEl = document.getElementById('actionsRow');
  const progressFillEl = document.getElementById('progressFill');
  const statsLineEl = document.getElementById('statsLine');
  const sourceLabelEl = document.getElementById('sourceLabel');
  const rescanLink = document.getElementById('rescanLink');

  const DRAG_THRESHOLD = 110;
  let state = null; // last /api/queue payload
  let dragging = null;

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

  function renderPreview(item) {
    const wrap = document.createElement('div');
    wrap.className = 'preview';
    const src = `/api/preview/${item.id}`;
    switch (item.previewType) {
      case 'image': {
        const img = document.createElement('img');
        img.src = src;
        img.alt = item.title;
        img.draggable = false;
        wrap.appendChild(img);
        break;
      }
      case 'audio': {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = src;
        wrap.style.padding = '40px 10px';
        wrap.appendChild(audio);
        break;
      }
      case 'video': {
        const video = document.createElement('video');
        video.controls = true;
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
        wrap.textContent = '\u{1F4C4}';
      }
    }
    return wrap;
  }

  function renderCard(item, actions) {
    const card = document.createElement('div');
    card.className = 'card';
    card.appendChild(renderPreview(item));

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title;
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
      card.appendChild(stamp);
    }

    attachDrag(card, actions);
    return card;
  }

  function attachDrag(card, actions) {
    const leftAction = actions.find((a) => a.direction === 'left');
    const rightAction = actions.find((a) => a.direction === 'right');
    const leftStamp = card.querySelector('.stamp.left');
    const rightStamp = card.querySelector('.stamp.right');

    function onPointerDown(e) {
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
        flingAndAct(card, rightAction, 1);
      } else if (dx < -DRAG_THRESHOLD && leftAction) {
        flingAndAct(card, leftAction, -1);
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

  function flingAndAct(card, action, dir) {
    card.style.transition = 'transform 0.25s ease-out';
    card.style.transform = `translate(${dir * 500}px, -40px) rotate(${dir * 25}deg)`;
    setTimeout(() => performAction(action.id), 120);
  }

  function renderActionsRow(actions) {
    actionsRowEl.innerHTML = '';
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      if (action.id === 'keep') btn.classList.add('keep');
      if (action.isDestructive) btn.classList.add('reject');
      btn.textContent = action.label;
      btn.addEventListener('click', () => performAction(action.id));
      actionsRowEl.appendChild(btn);
    }
    const undoBtn = document.createElement('button');
    undoBtn.className = 'action-btn undo';
    undoBtn.textContent = 'Undo';
    undoBtn.disabled = !state || !state.canUndo;
    undoBtn.addEventListener('click', undo);
    actionsRowEl.appendChild(undoBtn);
  }

  function renderStats() {
    if (!state) return;
    const pct = state.total ? Math.round((state.reviewed / state.total) * 100) : 0;
    progressFillEl.style.width = `${pct}%`;
    sourceLabelEl.textContent = state.sourceLabel || '';
    const countBits = Object.entries(state.counts || {})
      .map(([id, n]) => `${id}: ${n}`)
      .join(' \u00b7 ');
    statsLineEl.textContent = `${state.reviewed}/${state.total} reviewed${countBits ? '  \u2014  ' + countBits : ''}`;
  }

  function renderDeck() {
    deckEl.innerHTML = '';
    if (!state) return;
    if (!state.current) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const countBits = Object.entries(state.counts || {})
        .map(([id, n]) => `<strong>${n}</strong> ${id}`)
        .join(' &nbsp;&nbsp; ');
      empty.innerHTML = `All done. ${state.total} item(s) reviewed.<div class="summary">${countBits}</div>`;
      deckEl.appendChild(empty);
      renderActionsRow([]);
      return;
    }
    const card = renderCard(state.current, state.actions);
    deckEl.appendChild(card);
    renderActionsRow(state.actions);
  }

  function render() {
    renderStats();
    renderDeck();
  }

  function showError(message) {
    deckEl.innerHTML = `<div class="error-state">${message}</div>`;
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
    try {
      state = await api('/api/undo', { method: 'POST' });
      render();
    } catch (err) {
      showError(err.message);
    }
  }

  rescanLink.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      state = await api('/api/rescan', { method: 'POST' });
      render();
    } catch (err) {
      showError(err.message);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!state || !state.current) return;
    if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      undo();
      return;
    }
    const action = (state.actions || []).find((a) => a.key === e.key);
    if (action) {
      e.preventDefault();
      performAction(action.id);
    }
  });

  refresh();
})();
