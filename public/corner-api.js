/**
 * Corner's same-origin HTTP boundary.
 *
 * This module owns endpoint paths and the translation from host responses to
 * the bounded errors/failed-wake shape consumed by the renderer. It does not
 * own live stream transport or any presentation state.
 */

export async function request(path, options) {
  const response = await fetch(path, options);
  let data;
  try { data = await response.json(); } catch { throw { code: 'host_unavailable', message: `Host returned HTTP ${response.status}.` }; }
  if (!response.ok) {
    if (data && typeof data === 'object' && (data.failureCode || data.status === 'failed')) return { ...data, __failedWake: true };
    throw data.error || { code: 'host_error', message: data.failureMessage || 'Host request failed.' };
  }
  return data;
}

export function decideApproval(approvalId, decision) {
  return request(`/api/approvals/${encodeURIComponent(approvalId)}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
}

export function getWorld() {
  return request('/api/world');
}

export function getApprovals() {
  return request('/api/approvals');
}

export function getWake(wakeId) {
  return request(`/api/wakes/${encodeURIComponent(wakeId)}`);
}

export function getHealth() {
  return request('/api/health');
}

export function getActiveThread() {
  return request('/api/thread?scope=active');
}

export function getWakeSlips(wakeId) {
  return request(`/api/wakes/${encodeURIComponent(wakeId)}/slips`);
}

export function getEventHistory(afterSequence, limit) {
  return request(`/api/events/history?after=${afterSequence}&limit=${limit}`);
}

export function submitWake(content) {
  return request('/api/wakes?projection=compact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}
