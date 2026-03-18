export function createEmbedHost() {
  const state = {
    apiBase: '',
    tenantId: '',
    pluginAuth: '',
  };

  function applyInit(payload = {}) {
    if (payload.apiBase) state.apiBase = String(payload.apiBase).trim();
    if (payload.tenantId) state.tenantId = String(payload.tenantId).trim();
    if (payload.pluginAuth) state.pluginAuth = String(payload.pluginAuth).trim();
  }

  function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const apiBase = params.get('apiBase');
    const tenantId = params.get('tenantId');
    if (apiBase) state.apiBase = apiBase;
    if (tenantId) state.tenantId = tenantId;
  }

  function buildUrl(path) {
    if (!path) return state.apiBase || '';
    if (path.startsWith('http')) return path;
    const base = state.apiBase || '';
    if (!base) return path;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async function authFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.pluginAuth) headers.set('authorization', `Bearer ${state.pluginAuth}`);
    if (state.tenantId) headers.set('x-tenant-id', state.tenantId);
    return fetch(buildUrl(path), { ...options, headers });
  }

  window.addEventListener('message', (e) => {
    const msg = e.data || {};
    if (msg.type === 'INIT' && msg.payload) {
      applyInit(msg.payload);
    }
    if (msg.type === 'TOKEN_UPDATE' && msg.payload) {
      if (msg.payload.pluginAuth) state.pluginAuth = String(msg.payload.pluginAuth).trim();
    }
  });

  applyUrlParams();

  return {
    state,
    applyInit,
    buildUrl,
    authFetch,
  };
}
