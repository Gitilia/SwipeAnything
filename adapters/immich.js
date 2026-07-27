'use strict';

const { Readable } = require('stream');
const { Adapter } = require('./base');

/**
 * Second reference adapter, deliberately different from the folder adapter:
 * a remote API instead of the filesystem. Swipe through an Immich
 * (https://immich.app) photo library -- "reject" moves the asset to
 * Immich's own trash (its normal recoverable delete), "undo" restores it.
 *
 * Early adapter: tested against the documented API shape, not against every
 * Immich version. If your server's search/metadata response looks different,
 * please open a PR -- see CONTRIBUTING.md.
 */
class ImmichAdapter extends Adapter {
  static id = 'immich';
  static label = 'Immich';
  static description =
    "Swipe through a self-hosted Immich photo library. Reject moves the asset to Immich's own trash; undo restores it.";

  static configSchema = [
    { key: 'serverUrl', label: 'Server URL', type: 'text', required: true, placeholder: 'https://immich.example.com' },
    { key: 'apiKey', label: 'API key', type: 'password', required: true, placeholder: 'immich_api_key_…' },
    {
      key: 'mode',
      label: 'Order',
      type: 'select',
      default: 'chronological',
      options: [
        { value: 'chronological', label: 'Newest first' },
        { value: 'random', label: 'Random' },
      ],
    },
    { key: 'take', label: 'How many to load per session', type: 'number', default: 100 },
    { key: 'skipVideos', label: 'Skip videos', type: 'checkbox', default: false },
  ];

  static actions = [
    { id: 'keep', label: 'Keep', key: 'ArrowRight', direction: 'right' },
    { id: 'reject', label: 'Reject', key: 'ArrowLeft', direction: 'left', isDestructive: true },
    { id: 'skip', label: 'Skip', key: 'ArrowDown', direction: 'down' },
  ];

  constructor(settings) {
    super(settings);
    this.serverUrl = String(settings.serverUrl || '').replace(/\/+$/, '');
    this.apiKey = settings.apiKey || '';
    this.mode = settings.mode === 'random' ? 'random' : 'chronological';
    this.take = Number(settings.take) > 0 ? Number(settings.take) : 100;
    this.skipVideos = Boolean(settings.skipVideos);
  }

  async _request(pathname, options = {}) {
    if (!this.serverUrl) throw new Error('Server URL is required');
    if (!this.apiKey) throw new Error('API key is required');
    const url = `${this.serverUrl}/api${pathname}`;
    let res;
    try {
      res = await fetch(url, {
        ...options,
        headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
    } catch (err) {
      throw new Error(`Could not reach Immich at ${this.serverUrl}: ${err.message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Immich API ${pathname} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
    }
    return res;
  }

  async init() {
    // Fails fast with a clear message if the URL/key are wrong, before we
    // ever try to build a queue.
    await this._request('/users/me');
  }

  async list() {
    let assets;
    if (this.mode === 'random') {
      const res = await this._request(`/assets/random?count=${this.take}`);
      assets = await res.json();
    } else {
      const res = await this._request('/search/metadata', {
        method: 'POST',
        body: JSON.stringify({ take: this.take, order: 'desc' }),
      });
      const body = await res.json();
      assets = body.assets ? body.assets.items : Array.isArray(body) ? body : [];
    }

    return assets
      .filter((asset) => !this.skipVideos || asset.type !== 'VIDEO')
      .map((asset) => ({
        id: asset.id,
        title: asset.originalFileName || asset.id,
        subtitle: (asset.exifInfo && asset.exifInfo.dateTimeOriginal) || asset.fileCreatedAt || undefined,
        previewType: asset.type === 'VIDEO' ? 'video' : 'image',
        meta: {
          type: asset.type === 'VIDEO' ? 'video' : 'photo',
          favorite: asset.isFavorite ? 'yes' : 'no',
        },
      }));
  }

  async _streamAssetImage(assetId, size, res) {
    let upstream;
    try {
      upstream = await this._request(`/assets/${assetId}/thumbnail?size=${size}`);
    } catch {
      return false;
    }
    if (!upstream.body) return false;
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    Readable.fromWeb(upstream.body).pipe(res);
    return true;
  }

  async streamPreview(itemId, res) {
    return this._streamAssetImage(itemId, 'preview', res);
  }

  async streamThumbnail(itemId, res) {
    return this._streamAssetImage(itemId, 'thumbnail', res);
  }

  async getDetails(itemId) {
    const res = await this._request(`/assets/${itemId}`);
    const asset = await res.json();
    const fields = [
      { label: 'Name', value: asset.originalFileName || asset.id },
      { label: 'Type', value: asset.type },
      { label: 'Created', value: asset.fileCreatedAt },
      { label: 'Favorite', value: asset.isFavorite ? 'yes' : 'no' },
    ];
    const exif = asset.exifInfo || {};
    if (exif.exifImageWidth && exif.exifImageHeight) {
      fields.push({ label: 'Dimensions', value: `${exif.exifImageWidth} × ${exif.exifImageHeight}` });
    }
    if (exif.make || exif.model) {
      fields.push({ label: 'Camera', value: [exif.make, exif.model].filter(Boolean).join(' ') });
    }
    if (exif.dateTimeOriginal) fields.push({ label: 'Captured', value: exif.dateTimeOriginal });
    if (exif.city || exif.country) {
      fields.push({ label: 'Location', value: [exif.city, exif.state, exif.country].filter(Boolean).join(', ') });
    }
    if (exif.lensModel) fields.push({ label: 'Lens', value: exif.lensModel });
    if (asset.originalPath) fields.push({ label: 'Path', value: asset.originalPath });
    return { fields: fields.filter((f) => f.value), actions: [] };
  }

  uiHints() {
    return { showDetailsByDefault: false, supportsDetails: true };
  }

  async applyAction(item, actionId) {
    if (actionId === 'reject') {
      await this._request('/assets', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [item.id], force: false }),
      });
      return { type: 'trash', assetId: item.id };
    }
    // 'keep' and 'skip' have no effect on the library.
    return null;
  }

  async undo(record) {
    if (record && record.type === 'trash') {
      await this._request('/trash/restore/assets', {
        method: 'POST',
        body: JSON.stringify({ ids: [record.assetId] }),
      });
    }
  }

  describeSource() {
    return `${this.serverUrl} (Immich, ${this.mode})`;
  }
}

module.exports = { ImmichAdapter };
