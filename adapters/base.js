'use strict';

/**
 * Base contract every SwipeAnything adapter implements.
 *
 * An adapter turns "some collection of things" (files, emails, database
 * rows, ...) into a queue of swipeable cards, and knows how to apply and
 * undo the actions a user can take on each card. The core server and UI
 * never know what an adapter actually touches -- they only talk to this
 * interface.
 *
 * See CONTRIBUTING.md for a walkthrough of writing a new adapter, and
 * adapters/folder.js (local files) / adapters/immich.js (remote API) for
 * two different reference implementations.
 */
class Adapter {
  /** Unique machine id, e.g. "folder". Stored in swipeanything.config.json. */
  static id = 'base';

  /** Human-friendly name shown in the settings UI. */
  static label = 'Base adapter';

  /** One-line description shown in the settings UI. */
  static description = '';

  /**
   * Declares the settings this adapter needs, so the settings UI can render
   * a generic form without adapter-specific frontend code. Each entry:
   *   {
   *     key: string,
   *     label: string,
   *     type: 'text' | 'password' | 'checkbox' | 'number' | 'select' | 'folder',
   *     default?: any,
   *     options?: Array<{ value: string, label: string }>, // for type 'select'
   *     placeholder?: string,
   *     required?: boolean,
   *   }
   * `type: 'folder'` renders a text field plus a "Browse..." button backed
   * by a native folder picker where available (see server.js /api/browse-folder).
   */
  static configSchema = [];

  /**
   * Actions available on every card. The first two are the swipe defaults
   * (right = keep, left = reject); adapters may add more, e.g. a third
   * "later" bucket, as long as each has a distinct `key` and `direction`.
   *   {
   *     id: string,
   *     label: string,
   *     key: string,        // KeyboardEvent.key that triggers it
   *     direction: 'left' | 'right' | 'up' | 'down',
   *     isDestructive?: boolean,
   *   }
   */
  static actions = [
    { id: 'keep', label: 'Keep', key: 'ArrowRight', direction: 'right' },
    { id: 'reject', label: 'Reject', key: 'ArrowLeft', direction: 'left', isDestructive: true },
  ];

  constructor(settings = {}) {
    this.settings = settings;
  }

  /**
   * Optional async setup: validate settings, open a mailbox, connect to a
   * database, create a trash directory, etc. Throw a descriptive Error to
   * surface a validation message in the settings UI.
   */
  async init() {}

  /**
   * Returns the full queue of items to review, in order. Called once per
   * session (see the "Rescan" action in the UI to rebuild it).
   * @returns {Promise<Array<{
   *   id: string,
   *   title: string,
   *   subtitle?: string,
   *   previewType?: 'image' | 'audio' | 'video' | 'text' | 'none',
   *   meta?: Record<string, string | number>,
   * }>>}
   */
  async list() {
    throw new Error(`${this.constructor.name} must implement list()`);
  }

  /**
   * Applies `actionId` to `item`. Return whatever undo() needs to reverse
   * the effect, or null/undefined if the action has no side effect (e.g.
   * "keep" on a filesystem adapter just leaves the file alone).
   */
  async applyAction(item, actionId) {
    throw new Error(`${this.constructor.name} must implement applyAction()`);
  }

  /** Reverses the effect described by the record returned from applyAction(). */
  async undo(record) {
    throw new Error(`${this.constructor.name} must implement undo()`);
  }

  /**
   * Writes the full-size preview for `itemId` directly to the Express
   * response (res.sendFile for local files, a piped fetch for remote
   * APIs, etc). Return true if you wrote a response, false to let the
   * server respond 404 (e.g. this item has no visual preview).
   */
  async streamPreview(itemId, res) {
    return false;
  }

  /**
   * Same as streamPreview, but for a smaller/faster thumbnail (used for
   * the card image and as a video poster frame). Optional -- the default
   * does nothing, and the frontend falls back to streamPreview.
   */
  async streamThumbnail(itemId, res) {
    return false;
  }

  /**
   * Optional: describes a reversible "trash" this adapter maintains, so
   * the UI can offer an explicit, confirm-guarded "Empty trash" action.
   * Return null if this adapter has no such concept.
   * @returns {Promise<{ count: number, label: string } | null>}
   */
  async describeTrash() {
    return null;
  }

  /** Optional: permanently clears whatever describeTrash() described. */
  async emptyTrash() {
    throw new Error(`${this.constructor.name} does not support emptyTrash()`);
  }

  /** Optional short string describing the source, shown in the UI header. */
  describeSource() {
    return '';
  }
}

module.exports = { Adapter };
