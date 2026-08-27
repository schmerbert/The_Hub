import { CENTER, CENTER_EXTENSION, HUB_CONTAINER } from './hub/center.js';
import { WORKSHOP } from './hub/workshop.js';
import { GARDEN } from './garden/index.js';
import { HOUSE, HEARTH } from './house/index.js';
import { THRESHOLD } from './threshold/index.js';
import { FOREST_PLACE } from './forest/index.js';

export const PLACE_MODULES = Object.freeze([
  HUB_CONTAINER, CENTER, CENTER_EXTENSION, WORKSHOP, GARDEN, HOUSE, HEARTH, THRESHOLD, FOREST_PLACE,
]);

export function placeModuleById(id) { return PLACE_MODULES.find(module => module.id === id) || null; }
