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
 * See CONTRIBUTING.md for a walkthrough of writing a new adapter.
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
   *     type: 'text' | 'checkbox' | 'number' | 'select',
   *     default?: any,
   *     options?: Array<{ value: string, label: string }>, // for type 'select'
   *     placeholder?: string,
   *     required?: boolean,
   *   }
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
   * Optional: resolve an item id to an absolute file path so the
   * /api/preview endpoint can stream it. Adapters without file-like
   * previews (e.g. a future database-row adapter) can leave this as-is;
   * the UI falls back to title/subtitle/meta only.
   */
  async resolvePreviewPath(itemId) {
    return null;
  }

  /** Optional short string describing the source, shown in the UI header. */
  describeSource() {
    return '';
  }
}

module.exports = { Adapter };
