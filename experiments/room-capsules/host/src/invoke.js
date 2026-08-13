export function inspectActivatedCapsule(activation, labHost) {
  return activation.capsule.inspect(labHost.view());
}

export function invokeDeclaredOperation(activation, labHost, operationId, input = null) {
  const operation = activation.descriptor.manifest.operations.find(({ id }) => id === operationId);
  if (!operation) throw new Error(`Unknown or undeclared operation: ${operationId}`);
  if (operation.externalEffects !== false || operation.observationalOnly !== true) throw new Error(`External-effect operation refused: ${operationId}`);
  const hostView = labHost.view();
  const inspection = activation.capsule.inspect(hostView);
  const mode = inspection?.modes?.[operation.requiredMode];
  if (!mode?.available) {
    const reasons = [...(mode?.missing ?? []).map((id) => `missing ${id}`), ...(mode?.unbound ?? []).map((id) => `unbound ${id}`)];
    throw new Error(`Required mode ${operation.requiredMode} unavailable${reasons.length ? `: ${reasons.join(', ')}` : ''}`);
  }
  return activation.capsule.invoke(operationId, hostView, input);
}
