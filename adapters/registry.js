'use strict';

const { FolderAdapter } = require('./folder');
const { ImmichAdapter } = require('./immich');

// Register new adapters here. See CONTRIBUTING.md for the full guide.
const ADAPTERS = {
  [FolderAdapter.id]: FolderAdapter,
  [ImmichAdapter.id]: ImmichAdapter,
};

function getAdapter(id) {
  return ADAPTERS[id];
}

function listAdapters() {
  return Object.values(ADAPTERS).map((AdapterClass) => ({
    id: AdapterClass.id,
    label: AdapterClass.label,
    description: AdapterClass.description,
    configSchema: AdapterClass.configSchema,
    actions: AdapterClass.actions,
  }));
}

module.exports = { ADAPTERS, getAdapter, listAdapters };
