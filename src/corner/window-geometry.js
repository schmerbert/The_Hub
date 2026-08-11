export const COMPACT_WINDOW_SIZE = Object.freeze({ width: 96, height: 96 });
export const EXPANDED_WINDOW_SIZE = Object.freeze({ width: 980, height: 680 });
export const CORNER_MARGIN = 24;

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer.`);
  return value;
}

export function cornerBounds(display, size, margin = CORNER_MARGIN) {
  const workArea = display?.workArea;
  if (!workArea) throw new TypeError('A display work area is required.');
  const width = Math.min(positiveInteger(size?.width, 'Window width'), positiveInteger(workArea.width, 'Work area width'));
  const height = Math.min(positiveInteger(size?.height, 'Window height'), positiveInteger(workArea.height, 'Work area height'));
  if (!Number.isInteger(margin) || margin < 0) throw new TypeError('Corner margin must be a non-negative integer.');
  const availableX = Math.max(0, workArea.width - width);
  const availableY = Math.max(0, workArea.height - height);
  return {
    x: Math.round(workArea.x + Math.max(0, availableX - margin)),
    y: Math.round(workArea.y + Math.max(0, availableY - margin)),
    width,
    height,
  };
}

export function activeDisplay(screen, window = null) {
  if (window && typeof window.isDestroyed === 'function' && !window.isDestroyed() && typeof screen.getDisplayMatching === 'function') {
    return screen.getDisplayMatching(window.getBounds());
  }
  if (typeof screen.getDisplayNearestPoint === 'function' && typeof screen.getCursorScreenPoint === 'function') {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }
  return screen.getPrimaryDisplay();
}
