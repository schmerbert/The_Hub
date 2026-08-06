import { assertScrubbedPresentation } from '../scrub/provider-presentation.js';

// The messages argument here is a compatibility bridge for existing injected test
// providers. The server never constructs or passes an arbitrary provider history;
// this adapter derives the bridge only from a validated ScrubbedPresentation.
export function prepareProviderRequest(provider, { presentation, model, thinking = 'disabled', phase = 'ordinary', tools, toolChoice }) {
  assertScrubbedPresentation(presentation);
  if (provider.prepareRequest) {
    return provider.prepareRequest({ presentation, messages: presentation.messages, model, thinking, phase, tools, toolChoice });
  }
  const requestBody = {
      model,
      messages: presentation.messages,
      stream: false,
      thinking: { type: thinking === 'enabled' ? 'enabled' : 'disabled' },
    };
  if (tools) requestBody.tools = tools;
  if (toolChoice) requestBody.tool_choice = toolChoice;
  return { requestBody };
}

export function completeProvider(provider, { presentation, model, phase = 'ordinary', requestBodyString, onBeforeDispatch, onDispatch, onOutcome }) {
  assertScrubbedPresentation(presentation);
  return provider.complete({ presentation, messages: presentation.messages, model, phase, requestBodyString, onBeforeDispatch, onDispatch, onOutcome });
}
