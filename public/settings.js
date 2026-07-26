(() => {
  'use strict';

  const adapterListEl = document.getElementById('adapterList');
  const formEl = document.getElementById('settingsForm');
  const errorEl = document.getElementById('settingsError');

  let adapters = [];
  let selectedAdapterId = null;
  let currentSettings = {};
  let savedConfig = null;

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed: ${res.status}`);
    return body;
  }

  function fieldValue(field) {
    const el = document.getElementById(`field_${field.key}`);
    if (!el) return field.default;
    if (field.type === 'checkbox') return el.checked;
    if (field.type === 'number') return Number(el.value);
    return el.value;
  }

  function escapeAttr(value) {
    return String(value).replace(/"/g, '&quot;');
  }

  function renderField(field) {
    const wrap = document.createElement('div');
    const existing = currentSettings[field.key];
    const value = existing !== undefined ? existing : field.default;

    if (field.type === 'checkbox') {
      wrap.className = 'form-field checkbox';
      wrap.innerHTML = `
        <input type="checkbox" id="field_${field.key}" ${value ? 'checked' : ''}>
        <label for="field_${field.key}">${field.label}</label>
      `;
      return wrap;
    }

    if (field.type === 'folder') {
      wrap.className = 'form-field';
      wrap.innerHTML = `
        <label for="field_${field.key}">${field.label}${field.required ? ' *' : ''}</label>
        <div class="folder-field-row">
          <input type="text" id="field_${field.key}"
            value="${value !== undefined ? String(value).replace(/"/g, '&quot;') : ''}"
            placeholder="${field.placeholder || ''}">
          <button type="button" class="secondary-btn" data-browse-for="field_${field.key}">Browse&hellip;</button>
        </div>
        <div class="field-hint" data-browse-hint-for="field_${field.key}"></div>
      `;
      const browseBtn = wrap.querySelector(`[data-browse-for="field_${field.key}"]`);
      const hintEl = wrap.querySelector(`[data-browse-hint-for="field_${field.key}"]`);
      browseBtn.addEventListener('click', async () => {
        hintEl.textContent = '';
        browseBtn.disabled = true;
        browseBtn.textContent = 'Waiting for Finder\u2026';
        try {
          const { path: chosen } = await api('/api/browse-folder', { method: 'POST' });
          document.getElementById(`field_${field.key}`).value = chosen;
        } catch (err) {
          if (err.message !== 'Cancelled') hintEl.textContent = err.message;
        } finally {
          browseBtn.disabled = false;
          browseBtn.textContent = 'Browse\u2026';
        }
      });
      return wrap;
    }

    if (field.type === 'select') {
      wrap.className = 'form-field';
      const optionsHtml = (field.options || [])
        .map(
          (opt) =>
            `<option value="${escapeAttr(opt.value)}" ${opt.value === value ? 'selected' : ''}>${opt.label}</option>`
        )
        .join('');
      wrap.innerHTML = `
        <label for="field_${field.key}">${field.label}${field.required ? ' *' : ''}</label>
        <select id="field_${field.key}">${optionsHtml}</select>
      `;
      return wrap;
    }

    wrap.className = 'form-field';
    const inputType = field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text';
    wrap.innerHTML = `
      <label for="field_${field.key}">${field.label}${field.required ? ' *' : ''}</label>
      <input type="${inputType}" id="field_${field.key}" autocomplete="${field.type === 'password' ? 'off' : 'on'}"
        value="${value !== undefined ? escapeAttr(value) : ''}"
        placeholder="${field.placeholder || ''}">
    `;
    return wrap;
  }

  function renderForm() {
    formEl.innerHTML = '';
    const adapter = adapters.find((a) => a.id === selectedAdapterId);
    if (!adapter) return;
    for (const field of adapter.configSchema) {
      formEl.appendChild(renderField(field));
    }
    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'primary-btn';
    saveBtn.textContent = 'Save & start swiping';
    formEl.appendChild(saveBtn);
  }

  function settingsFor(adapterId) {
    if (savedConfig && savedConfig.adapter === adapterId) {
      return { ...(savedConfig.settings || {}) };
    }
    return {};
  }

  function renderAdapterList() {
    adapterListEl.innerHTML = '';
    for (const adapter of adapters) {
      const selected = adapter.id === selectedAdapterId;
      const card = document.createElement('label');
      card.className = `adapter-card${selected ? ' selected' : ''}`;
      card.innerHTML = `
        <div class="adapter-card-title">
          <input type="radio" name="adapter" value="${adapter.id}"
            aria-label="${adapter.label}" ${selected ? 'checked' : ''}>
          <strong>${adapter.label}</strong>
        </div>
        <div class="adapter-desc">${adapter.description || ''}</div>
      `;
      card.querySelector('input').addEventListener('change', () => {
        selectedAdapterId = adapter.id;
        currentSettings = settingsFor(adapter.id);
        renderAdapterList();
        renderForm();
      });
      adapterListEl.appendChild(card);
    }
  }

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const adapter = adapters.find((a) => a.id === selectedAdapterId);
    if (!adapter) return;
    const settings = {};
    for (const field of adapter.configSchema) {
      settings[field.key] = fieldValue(field);
    }
    try {
      await api('/api/config', {
        method: 'POST',
        body: JSON.stringify({ adapter: adapter.id, settings }),
      });
      window.location.href = 'index.html';
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  async function init() {
    const [adapterList, configResp] = await Promise.all([api('/api/adapters'), api('/api/config')]);
    adapters = adapterList;
    savedConfig = configResp.config || null;
    if (savedConfig) {
      selectedAdapterId = savedConfig.adapter;
      currentSettings = settingsFor(selectedAdapterId);
    } else {
      selectedAdapterId = adapters[0] && adapters[0].id;
      currentSettings = {};
    }
    renderAdapterList();
    renderForm();
  }

  init().catch((err) => {
    errorEl.textContent = err.message;
  });
})();
