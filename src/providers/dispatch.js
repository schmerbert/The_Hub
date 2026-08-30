import { assertScrubbedPresentation } from '../scrub/provider-presentation.js';

// The messages argument here is a compatibility bridge for existing injected test
// providers. The server never constructs or passes an arbitrary provider history;
// this adapter derives the bridge only from a validated ScrubbedPresentation.
export function prepareProviderRequest(provider, { presentation, model, thinking = 'disabled', reasoningEffort = null, phase = 'ordinary', tools, toolChoice }) {
  assertScrubbedPresentation(presentation);
  if (provider.prepareRequest) {
    return provider.prepareRequest({ presentation, messages: presentation.messages, model, thinking, reasoningEffort, phase, tools, toolChoice });
  }
  const requestBody = {
      model,
      messages: presentation.messages,
      stream: false,
      thinking: { type: thinking === 'enabled' ? 'enabled' : 'disabled' },
    };
  if (thinking === 'enabled') {
    if (!['low', 'high'].includes(reasoningEffort)) throw new Error('Enabled provider thinking requires an installed reasoning effort.');
    requestBody.reasoning_effort = reasoningEffort;
  }
  if (tools) requestBody.tools = tools;
  if (toolChoice) requestBody.tool_choice = toolChoice;
  return { requestBody };
}

export function completeProvider(provider, { presentation, model, phase = 'ordinary', requestBodyString, onBeforeDispatch, onDispatch, onRawReturn, onDelta, onOutcome, signal }) {
  assertScrubbedPresentation(presentation);
  return provider.complete({ presentation, messages: presentation.messages, model, phase, requestBodyString, onBeforeDispatch, onDispatch, onRawReturn, onDelta, onOutcome, signal });
}
