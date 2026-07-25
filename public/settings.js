(() => {
  'use strict';

  const adapterListEl = document.getElementById('adapterList');
  const formEl = document.getElementById('settingsForm');
  const errorEl = document.getElementById('settingsError');

  let adapters = [];
  let selectedAdapterId = null;
  let currentSettings = {};

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

    wrap.className = 'form-field';
    const inputType = field.type === 'number' ? 'number' : 'text';
    wrap.innerHTML = `
      <label for="field_${field.key}">${field.label}${field.required ? ' *' : ''}</label>
      <input type="${inputType}" id="field_${field.key}"
        value="${value !== undefined ? String(value).replace(/"/g, '&quot;') : ''}"
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

  function renderAdapterList() {
    adapterListEl.innerHTML = '';
    for (const adapter of adapters) {
      const card = document.createElement('label');
      card.className = 'adapter-card';
      card.innerHTML = `
        <div class="form-field checkbox" style="margin-bottom:0">
          <input type="radio" name="adapter" value="${adapter.id}" ${adapter.id === selectedAdapterId ? 'checked' : ''}>
          <strong>${adapter.label}</strong>
        </div>
        <div class="adapter-desc">${adapter.description || ''}</div>
      `;
      card.querySelector('input').addEventListener('change', () => {
        selectedAdapterId = adapter.id;
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
    if (configResp.config) {
      selectedAdapterId = configResp.config.adapter;
      currentSettings = configResp.config.settings || {};
    } else {
      selectedAdapterId = adapters[0] && adapters[0].id;
    }
    renderAdapterList();
    renderForm();
  }

  init().catch((err) => {
    errorEl.textContent = err.message;
  });
})();
