// Dados da versão antiga (localStorage) e arquivos de backup: lê, corrige formatos antigos
// e converte para o formato que a API aceita em POST /import.
(function () {
  const KEY = 'futebol-semanal:v1';
  const METHODS = ['dinheiro', 'pix', 'cartao', 'pago'];

  const clampLevel = (level) => {
    const n = Math.round(Number(level));
    return Number.isFinite(n) ? Math.min(6, Math.max(1, n)) : 3;
  };

  const toIso = (value) => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  };

  // Versões antigas: lista de cobranças ("games") com "paid"; cobrança com data "AAAA-MM-DD".
  function normalizeGame(data) {
    let g = data.game;
    if (!g && Array.isArray(data.games) && data.games.length) {
      g = data.games.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    }
    if (!g || typeof g !== 'object') return null;
    return {
      createdAt: toIso(g.createdAt || (g.date ? `${g.date}T12:00:00` : Date.now())),
      total: Math.max(0, Number(g.total) || 0),
      players: (Array.isArray(g.players) ? g.players : [])
        .filter((p) => p && (p.playerId || p.id))
        .map((p) => ({
          // Exportações novas trazem "playerId" (id do cadastro) separado do id da linha da cobrança.
          id: String(p.playerId || p.id),
          name: String(p.name || '').slice(0, 40),
          method: METHODS.includes(p.method) ? p.method : p.paid ? 'pago' : null,
        })),
    };
  }

  // Formato intermediário: cada time tinha seu goleiro ({ gk, ids }).
  function normalizeDraw(draw) {
    if (!draw || !Array.isArray(draw.teams)) return null;
    const goalkeepers = Array.isArray(draw.goalkeepers) ? draw.goalkeepers.map(String) : [];
    const teams = draw.teams.map((t) => {
      if (Array.isArray(t)) return t.map(String);
      if (t && t.gk) goalkeepers.push(String(t.gk));
      return (t && t.ids ? t.ids : []).map(String);
    });
    if (teams.length < 2 || teams.length > 10) return null;
    return { date: toIso(draw.date), goalkeepers, teams };
  }

  /** Converte qualquer versão de backup/localStorage para o corpo de POST /import. */
  function toImport(data) {
    if (!data || typeof data !== 'object') throw new Error('Arquivo inválido.');
    const players = (Array.isArray(data.players) ? data.players : [])
      .filter((p) => p && typeof p.name === 'string' && p.name.trim())
      .map((p, i) => ({ id: String(p.id || `p${i}`), name: p.name.trim().slice(0, 40), level: clampLevel(p.level) }));
    const ids = new Set(players.map((p) => p.id));
    const settings = data.settings || {};
    return {
      players,
      selectedIds: (data.selectedIds || []).map(String).filter((id) => ids.has(id)),
      gkTodayIds: (data.gkTodayIds || []).map(String).filter((id) => ids.has(id)),
      settings: {
        numTeams: Math.min(10, Math.max(2, Number(settings.numTeams) || 2)),
        pixKey: String(settings.pixKey || '').slice(0, 80),
        pixQr: typeof settings.pixQr === 'string' && settings.pixQr.startsWith('data:image/') ? settings.pixQr : null,
      },
      lastDraw: normalizeDraw(data.lastDraw),
      game: normalizeGame(data),
    };
  }

  /** Dados que ficaram salvos neste navegador pela versão sem servidor (ou null). */
  function readLocal() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY));
      return data && Array.isArray(data.players) && data.players.length ? data : null;
    } catch {
      return null;
    }
  }

  const clearLocal = () => localStorage.removeItem(KEY);

  window.Legacy = { toImport, readLocal, clearLocal };
})();
