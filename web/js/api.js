// Cliente da API: token de sessão, erros em português e indicador de carregamento.
(function () {
  const TOKEN_KEY = 'futebol:token';
  const BASE = window.APP_CONFIG.API_URL;

  class ApiError extends Error {
    constructor(status, message, body) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }

  let pending = 0;
  const setBusy = (delta) => {
    pending += delta;
    document.body.classList.toggle('busy', pending > 0);
  };

  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

  // Chamado quando a sessão expira (401) em qualquer requisição autenticada.
  let onUnauthorized = () => {};

  // Primeira mensagem de validação (422) ou a mensagem geral do servidor.
  function messageFrom(status, body) {
    if (body && body.errors) {
      const first = Object.values(body.errors)[0];
      if (first && first[0]) return first[0];
    }
    if (body && typeof body.message === 'string') return body.message;
    if (status >= 500) return 'Erro no servidor. Tente de novo em instantes.';
    return `Erro ${status}`;
  }

  async function request(method, path, body) {
    const token = getToken();
    setBusy(1);
    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        headers: {
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'Sem conexão com o servidor. Verifique a internet.');
    } finally {
      setBusy(-1);
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      if (res.status === 401 && token && !path.startsWith('/auth/login')) {
        setToken(null);
        onUnauthorized();
      }
      throw new ApiError(res.status, messageFrom(res.status, data), data);
    }
    return data;
  }

  /** O Render gratuito "dorme": insiste no /health até o servidor acordar (até ~90 s). */
  async function wake(onSlow) {
    const started = Date.now();
    let warned = false;
    while (Date.now() - started < 90_000) {
      try {
        const res = await fetch(BASE + '/health', { cache: 'no-store' });
        if (res.ok) return true;
      } catch {
        /* ainda acordando */
      }
      if (!warned && Date.now() - started > 2500) {
        warned = true;
        onSlow && onSlow();
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  window.Api = {
    ApiError,
    request,
    wake,
    getToken,
    setToken,
    set onUnauthorized(fn) {
      onUnauthorized = fn;
    },
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b ?? {}),
    put: (p, b) => request('PUT', p, b),
    patch: (p, b) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
  };
})();
