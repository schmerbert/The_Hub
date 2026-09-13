export class RobinhoodConnectionError extends Error {
  constructor(code, message = code, details = undefined) {
    super(message);
    this.name = 'RobinhoodConnectionError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function fail(code, message = code, details = undefined) {
  throw new RobinhoodConnectionError(code, message, details);
}
