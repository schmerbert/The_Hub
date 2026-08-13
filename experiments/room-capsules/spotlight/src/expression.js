const ROOT_KEYS = new Set(['schemaVersion', 'expressionId', 'room', 'fixtures']);
const FORM_KEYS = new Set(['id', 'label', 'description', 'layout']);
const LAYOUT_KEYS = new Set(['zone', 'order', 'x', 'y', 'width', 'height']);
const FORBIDDEN = /^(capabilit(?:y|ies)|authorit(?:y|ies)|tools?|channels?|sockets?|wires?|crossings?|permissions?|effects?)$/i;

export function validateExpression(expression, manifest) {
  const errors = [];
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) return { ok: false, errors: ['expression must be an object'] };
  scanForbidden(expression, '$', errors);
  rejectUnknown(expression, ROOT_KEYS, '$', errors);
  if (expression.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (typeof expression.expressionId !== 'string' || !expression.expressionId.startsWith('expression.')) errors.push('expressionId must be an expression.* identifier');
  validateForm(expression.room, 'room', errors);
  if (expression.room?.id !== manifest.identity.id) errors.push(`room id must be ${manifest.identity.id}`);
  const declared = new Set(manifest.fixtureSlots.map(({ id }) => id));
  const seen = new Set();
  if (!Array.isArray(expression.fixtures)) errors.push('fixtures must be an array');
  for (const fixture of expression.fixtures ?? []) {
    validateForm(fixture, 'fixture', errors);
    if (!declared.has(fixture?.id)) errors.push(`undeclared fixture id: ${fixture?.id}`);
    if (seen.has(fixture?.id)) errors.push(`duplicate fixture expression: ${fixture?.id}`);
    seen.add(fixture?.id);
  }
  return { ok: errors.length === 0, errors };
}

function validateForm(form, path, errors) {
  if (!form || typeof form !== 'object' || Array.isArray(form)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnknown(form, FORM_KEYS, path, errors);
  if (typeof form.id !== 'string') errors.push(`${path}.id must be a string`);
  for (const key of ['label', 'description']) if (key in form && typeof form[key] !== 'string') errors.push(`${path}.${key} must be a string`);
  if (form.layout !== undefined) {
    if (!form.layout || typeof form.layout !== 'object' || Array.isArray(form.layout)) errors.push(`${path}.layout must be an object`);
    else rejectUnknown(form.layout, LAYOUT_KEYS, `${path}.layout`, errors);
  }
}

function rejectUnknown(object, allowed, path, errors) {
  for (const key of Object.keys(object)) if (!allowed.has(key)) errors.push(`${path}.${key} is not resident expression`);
}

function scanForbidden(value, path, errors) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.test(key)) errors.push(`${path}.${key} attempts to define machinery`);
    scanForbidden(child, `${path}.${key}`, errors);
  }
}
