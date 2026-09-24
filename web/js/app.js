(function () {
  const { drawTeams, sum } = window.Draw;

  let state = null; // estado vindo da API (GET /state)
  let editingId = null;
  let formLevel = 3;

  const $ = (sel) => document.querySelector(sel);

  const escapeHtml = (s) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const normalizeText = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');

  function levelBadge(level) {
    return `<span class="level level-${level}" title="Nível ${level}">${level}</span>`;
  }

  const svgIcon = (d) =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON_EDIT = svgIcon('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>');
  const ICON_TRASH = svgIcon('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>');

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------------- Comunicação com a API ----------------
  const FAIL = Symbol('fail');

  /** Executa uma chamada à API. Em erro, avisa e recarrega o estado do servidor (desfaz o otimista). */
  async function run(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 401) return FAIL; // tela de login já foi aberta
      toast(err.message || 'Algo deu errado.');
      await reload();
      return FAIL;
    }
  }

  async function reload() {
    try {
      state = await Api.get('/state');
      renderAll();
    } catch {
      /* o erro original já foi avisado */
    }
  }

  // Várias alterações rápidas (marcar vários jogadores) viram uma chamada só.
  function debounce(fn, ms) {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }
  const syncSelection = debounce(
    () => run(() => Api.put('/selection', { selectedIds: state.selectedIds, gkTodayIds: state.gkTodayIds })),
    350
  );
  const syncNumTeams = debounce(() => run(() => Api.patch('/settings', { numTeams: state.settings.numTeams })), 500);

  // ---------------- Abas ----------------
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach((p) =>
        p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`)
      );
      if (btn.dataset.tab === 'sorteio') renderSelection();
      if (btn.dataset.tab === 'pagamentos') payments.render();
    });
  });

  // ---------------- Formulário de jogador ----------------
  function renderLevelPicker() {
    const picker = $('#level-picker');
    picker.innerHTML = [1, 2, 3, 4, 5, 6]
      .map(
        (n) =>
          `<button type="button" role="radio" aria-checked="${n === formLevel}" class="level-opt level-${n} ${
            n === formLevel ? 'selected' : ''
          }" data-level="${n}">${n}</button>`
      )
      .join('');
  }

  $('#level-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-level]');
    if (!btn) return;
    formLevel = Number(btn.dataset.level);
    renderLevelPicker();
  });

  function resetForm() {
    editingId = null;
    formLevel = 3;
    $('#player-name').value = '';
    $('#form-title').textContent = 'Adicionar jogador';
    $('#form-submit').textContent = 'Adicionar';
    $('#form-cancel').classList.add('hidden');
    $('#player-form').classList.remove('editing');
    renderLevelPicker();
  }

  function startEdit(id) {
    const p = state.players.find((x) => x.id === id);
    if (!p) return;
    editingId = id;
    formLevel = p.level;
    $('#player-name').value = p.name;
    $('#form-title').textContent = `Editando: ${p.name}`;
    $('#form-submit').textContent = 'Salvar';
    $('#form-cancel').classList.remove('hidden');
    $('#player-form').classList.add('editing');
    renderLevelPicker();
    $('#player-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#player-name').focus();
  }

  $('#player-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#player-name').value.trim().replace(/\s+/g, ' ');
    if (!name) return;

    const duplicate = state.players.find(
      (p) => p.id !== editingId && normalizeText(p.name) === normalizeText(name)
    );
    if (duplicate) {
      toast(`Já existe um jogador chamado "${duplicate.name}".`);
      return;
    }

    const submit = $('#form-submit');
    submit.disabled = true;
    const body = { name, level: formLevel };
    const saved = await run(() => (editingId ? Api.patch(`/players/${editingId}`, body) : Api.post('/players', body)));
    submit.disabled = false;
    if (saved === FAIL) return;

    if (editingId) {
      state.players = state.players.map((p) => (p.id === saved.id ? saved : p));
      toast('Jogador atualizado.');
    } else {
      state.players.push(saved);
      toast(`${saved.name} adicionado.`);
    }
    resetForm();
    renderPlayers();
    $('#player-name').focus();
  });

  $('#form-cancel').addEventListener('click', resetForm);

  // ---------------- Lista de jogadores ----------------
  function sortedPlayers() {
    const mode = $('#player-sort').value;
    const list = state.players.slice();
    if (mode === 'level-desc') return list.sort((a, b) => b.level - a.level || byName(a, b));
    if (mode === 'level-asc') return list.sort((a, b) => a.level - b.level || byName(a, b));
    return list.sort(byName);
  }

  function renderPlayers() {
    const q = normalizeText($('#player-search').value.trim());
    const list = sortedPlayers().filter((p) => !q || normalizeText(p.name).includes(q));

    $('#player-count').textContent = state.players.length;
    $('#player-empty').style.display = state.players.length ? 'none' : '';
    $('#player-list').innerHTML = list
      .map(
        (p) => `
        <li class="player-row ${p.id === editingId ? 'is-editing' : ''}">
          ${levelBadge(p.level)}
          <span class="player-name">${escapeHtml(p.name)}</span>
          <button class="icon-btn" data-edit="${p.id}" title="Editar" aria-label="Editar ${escapeHtml(p.name)}">${ICON_EDIT}</button>
          <button class="icon-btn icon-danger" data-delete="${p.id}" title="Excluir" aria-label="Excluir ${escapeHtml(p.name)}">${ICON_TRASH}</button>
        </li>`
      )
      .join('');
  }

  $('#player-list').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-delete]');
    if (edit) startEdit(edit.dataset.edit);
    if (del) {
      const p = state.players.find((x) => x.id === del.dataset.delete);
      if (!p || !confirm(`Excluir ${p.name}?`)) return;
      if ((await run(() => Api.del(`/players/${p.id}`))) === FAIL) return;
      state.players = state.players.filter((x) => x.id !== p.id);
      state.selectedIds = state.selectedIds.filter((id) => id !== p.id);
      state.gkTodayIds = state.gkTodayIds.filter((id) => id !== p.id);
      // Na cobrança a pessoa continua (pelo nome), só perde o vínculo com o cadastro.
      if (state.game) state.game.players.forEach((gp) => gp.playerId === p.id && (gp.playerId = null));
      if (editingId === p.id) resetForm();
      renderPlayers();
      toast(`${p.name} excluído.`);
    }
  });

  $('#player-search').addEventListener('input', renderPlayers);
  $('#player-sort').addEventListener('change', renderPlayers);

  // ---------------- Conta e backup ----------------
  $('#export-btn').addEventListener('click', () => {
    const data = {
      ...state,
      game: state.game && {
        ...state.game,
        players: state.game.players.map((p) => ({ id: p.playerId || p.id, name: p.name, method: p.method })),
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `futebol-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  async function importData(raw, question) {
    let payload;
    try {
      payload = Legacy.toImport(raw);
    } catch {
      toast('Arquivo inválido.');
      return false;
    }
    if (!confirm(question(payload))) return false;
    const next = await run(() => Api.post('/import', payload));
    if (next === FAIL) return false;
    state = next;
    resetForm();
    renderAll();
    return true;
  }

  $('#import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      toast('Arquivo inválido.');
      return;
    }
    const ok = await importData(
      raw,
      (p) => `Importar ${p.players.length} jogadores? Os dados atuais da conta serão substituídos.`
    );
    if (ok) toast('Backup importado.');
  });

  $('#password-toggle').addEventListener('click', () => {
    $('#password-form').classList.toggle('hidden');
    $('#pw-current').focus();
  });
  $('#password-cancel').addEventListener('click', () => {
    $('#password-form').reset();
    $('#password-form').classList.add('hidden');
  });
  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { currentPassword: $('#pw-current').value, newPassword: $('#pw-new').value };
    try {
      await Api.patch('/auth/password', body);
      $('#password-form').reset();
      $('#password-form').classList.add('hidden');
      toast('Senha alterada. Outros aparelhos precisarão entrar de novo.');
    } catch (err) {
      if (err.status !== 401) toast(err.message);
    }
  });

  // ---------------- Seleção de quem vai jogar ----------------
  const GOALS = 2; // um goleiro fixo em cada gol durante o jogo todo
  const playerById = () => new Map(state.players.map((p) => [p.id, p]));

  // Marca/desmarca quem vai jogar. Quem é desmarcado também sai do gol.
  function setSelected(id, on) {
    const selected = new Set(state.selectedIds);
    const today = new Set(state.gkTodayIds);
    if (on) {
      selected.add(id);
    } else {
      selected.delete(id);
      today.delete(id);
    }
    state.selectedIds = [...selected];
    state.gkTodayIds = [...today];
  }

  function renderSelection() {
    const q = normalizeText($('#select-search').value.trim());
    const selected = new Set(state.selectedIds);
    const today = new Set(state.gkTodayIds);
    const list = state.players
      .slice()
      .sort(byName)
      .filter((p) => !q || normalizeText(p.name).includes(q));

    $('#select-empty').style.display = state.players.length ? 'none' : '';
    $('#select-list').innerHTML = list
      .map((p) => {
        const isSel = selected.has(p.id);
        const inGoal = today.has(p.id);
        // Qualquer jogador marcado pode ir pro gol.
        const gkBtn = isSel
          ? `<button type="button" class="gk-toggle ${inGoal ? 'on' : ''}" data-gk-toggle="${p.id}"
               title="${inGoal ? 'No gol (toque para jogar na linha)' : 'Toque para colocar no gol'}">🧤</button>`
          : '';
        return `
        <li>
          <label class="select-row ${isSel ? 'checked' : ''} ${inGoal ? 'in-goal' : ''}">
            <input type="checkbox" data-select="${p.id}" ${isSel ? 'checked' : ''} />
            ${inGoal ? '<span class="level level-gk" title="No gol">🧤</span>' : levelBadge(p.level)}
            <span class="player-name">${escapeHtml(p.name)}</span>
            ${gkBtn}
          </label>
        </li>`;
      })
      .join('');
    updateSelectionInfo();
  }

  function updateSelectionInfo() {
    const k = Number($('#num-teams').value) || 2;
    const byId = playerById();
    const gks = state.gkTodayIds.map((id) => byId.get(id)).filter(Boolean);
    const total = state.selectedIds.length;
    const field = total - gks.length;
    $('#selected-count').textContent = total;

    let hint = '';
    if (total === 0) hint = 'Selecione quem vai jogar.';
    else if (field < k) hint = `Selecione pelo menos ${k} jogadores de linha.`;
    else {
      const base = Math.floor(field / k);
      const extra = field % k;
      hint = extra
        ? `Linha: ${extra} time(s) com ${base + 1} e ${k - extra} com ${base} jogadores.`
        : `Linha: ${k} times de ${base} jogadores.`;
    }
    $('#config-hint').textContent = hint;

    const gkHint = $('#gk-hint');
    const names = gks.map((p) => p.name).join(' e ');
    if (total === 0) {
      gkHint.textContent = '';
    } else if (gks.length === GOALS) {
      gkHint.className = 'gk-hint ok';
      gkHint.textContent = `🧤 No gol: ${names}`;
    } else if (gks.length < GOALS) {
      const missing = GOALS - gks.length;
      gkHint.className = 'gk-hint warn';
      gkHint.textContent =
        `🧤 Falta${missing > 1 ? 'm' : ''} ${missing} goleiro${missing > 1 ? 's' : ''}` +
        (names ? ` (no gol: ${names})` : '') +
        '. Toque na 🧤 de alguém para colocar no gol.';
    } else {
      gkHint.className = 'gk-hint warn';
      gkHint.textContent = `🧤 ${gks.length} no gol (${names}). São só ${GOALS} gols — tire alguém tocando na 🧤.`;
    }

    $('#draw-btn').disabled = field < k || k < 2;
  }

  $('#select-list').addEventListener('change', (e) => {
    const id = e.target.dataset.select;
    if (!id) return;
    setSelected(id, e.target.checked);
    renderSelection();
    syncSelection();
  });

  $('#select-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-gk-toggle]');
    if (!btn) return;
    e.preventDefault(); // o botão fica dentro do <label>: não deve desmarcar o jogador
    const id = btn.dataset.gkToggle;
    const today = new Set(state.gkTodayIds);
    today.has(id) ? today.delete(id) : today.add(id);
    state.gkTodayIds = [...today];
    renderSelection();
    syncSelection();
  });

  $('#select-search').addEventListener('input', renderSelection);

  $('#select-all').addEventListener('click', () => {
    state.players.forEach((p) => setSelected(p.id, true));
    renderSelection();
    syncSelection();
  });

  $('#select-none').addEventListener('click', () => {
    state.selectedIds = [];
    state.gkTodayIds = [];
    renderSelection();
    syncSelection();
  });

  $('#num-teams').addEventListener('input', () => {
    const k = Math.min(10, Math.max(2, Number($('#num-teams').value) || 2));
    state.settings.numTeams = k;
    updateSelectionInfo();
    syncNumTeams();
  });

  // ---------------- Sorteio ----------------
  function doDraw() {
    const today = new Set(state.gkTodayIds);
    const selected = state.players.filter((p) => state.selectedIds.includes(p.id));
    const field = selected.filter((p) => !today.has(p.id));
    try {
      const teams = drawTeams(field, state.settings.numTeams);
      state.lastDraw = {
        date: new Date().toISOString(),
        goalkeepers: selected.filter((p) => today.has(p.id)).map((p) => p.id),
        teams: teams.map((t) => t.map((p) => p.id)),
      };
    } catch (err) {
      toast(err.message);
      return;
    }
    renderDraw();
    $('#draw-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    run(() => Api.put('/draw', state.lastDraw));
  }

  // Resolve o último sorteio a partir dos ids (reflete edições de nome/nível).
  function currentDraw() {
    if (!state.lastDraw) return null;
    const byId = playerById();
    const resolve = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);
    return {
      goalkeepers: resolve(state.lastDraw.goalkeepers),
      teams: state.lastDraw.teams.map(resolve),
    };
  }

  function renderDraw() {
    const draw = currentDraw();
    $('#draw-result').classList.toggle('hidden', !draw);
    if (!draw) return;
    const { goalkeepers, teams } = draw;

    const date = new Date(state.lastDraw.date);
    const totals = teams.map(sum);
    const spread = Math.max(...totals) - Math.min(...totals);
    $('#draw-meta').textContent =
      `Sorteado em ${date.toLocaleDateString('pt-BR')} às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` +
      ` · diferença de força entre times: ${spread}`;

    $('#draw-gks').innerHTML = goalkeepers.length
      ? `<span class="draw-gks-label">🧤 Goleiros</span>` +
        goalkeepers.map((p) => `<span class="draw-gk">${escapeHtml(p.name)}</span>`).join('')
      : `<span class="draw-gks-label">🧤 Sem goleiros definidos</span>`;

    $('#teams').innerHTML = teams
      .map((team, i) => {
        const total = sum(team);
        const avg = team.length ? (total / team.length).toFixed(1) : '0';
        return `
        <div class="team team-${i % 6}">
          <div class="team-header">
            <h3>Time ${i + 1}</h3>
            <span class="team-stats">${team.length} jog. · força ${total} · média ${avg}</span>
          </div>
          <ul>
            ${team.map((p) => `<li>${levelBadge(p.level)}<span>${escapeHtml(p.name)}</span></li>`).join('')}
          </ul>
        </div>`;
      })
      .join('');
  }

  function teamsAsText() {
    const { goalkeepers, teams } = currentDraw();
    const parts = [];
    if (goalkeepers.length) parts.push(`🧤 *Goleiros:* ${goalkeepers.map((p) => p.name).join(' e ')}`);
    teams.forEach((team, i) => parts.push(`*Time ${i + 1}*\n` + team.map((p) => `- ${p.name}`).join('\n')));
    return parts.join('\n\n');
  }

  $('#draw-btn').addEventListener('click', doDraw);
  // Apaga o resultado (times e goleiros); quem foi marcado para jogar continua marcado.
  $('#reset-draw-btn').addEventListener('click', async () => {
    if (!confirm('Apagar os times e goleiros sorteados?')) return;
    if ((await run(() => Api.del('/draw'))) === FAIL) return;
    state.lastDraw = null;
    renderDraw();
    toast('Sorteio apagado.');
  });
  $('#copy-btn').addEventListener('click', async () => {
    await copyText(teamsAsText());
    toast('Times copiados! Cole no WhatsApp.');
  });

  // ---------------- Pagamentos ----------------
  const payments = window.Payments.init({
    getState: () => state,
    api: Api,
    run,
    FAIL,
    toast,
    escapeHtml,
  });

  function renderAll() {
    $('#num-teams').value = state.settings.numTeams;
    renderLevelPicker();
    renderPlayers();
    renderSelection();
    renderDraw();
    payments.render();
  }

  // ---------------- Carregamento, login e sessão ----------------
  const show = (id, visible) => $(id).classList.toggle('hidden', !visible);
  let authMode = 'login';

  function lock() {
    document.body.classList.add('locked');
    state = null;
  }

  async function boot() {
    show('#boot-screen', true);
    show('#auth-screen', false);
    show('#boot-retry', false);
    show('#boot-slow', false);
    $('#boot-text').textContent = 'Carregando…';

    const awake = await Api.wake(() => {
      $('#boot-text').textContent = 'Acordando o servidor…';
      show('#boot-slow', true);
    });
    if (!awake) {
      $('#boot-text').textContent = 'Não foi possível falar com o servidor.';
      show('#boot-slow', false);
      show('#boot-retry', true);
      return;
    }

    if (Api.getToken()) {
      try {
        await start();
        return;
      } catch (err) {
        if (err.status !== 401) {
          $('#boot-text').textContent = err.message;
          show('#boot-retry', true);
          return;
        }
      }
    }
    await showAuth();
  }

  async function showAuth() {
    lock();
    let hasUser = true;
    try {
      hasUser = (await Api.get('/auth/status')).hasUser;
    } catch {
      /* se falhar, assume "Entrar" */
    }
    authMode = hasUser ? 'login' : 'setup';
    const setup = authMode === 'setup';
    $('#auth-title').textContent = setup ? 'Criar acesso' : 'Entrar';
    $('#auth-sub').textContent = setup
      ? 'Primeira vez por aqui: escolha o login e a senha que só você vai usar.'
      : 'Acesse seus jogadores, sorteios e pagamentos.';
    $('#auth-submit').textContent = setup ? 'Criar acesso' : 'Entrar';
    $('#auth-password').autocomplete = setup ? 'new-password' : 'current-password';
    show('#auth-confirm-field', setup);
    $('#auth-confirm').required = setup;
    $('#auth-error').textContent = '';
    show('#boot-screen', false);
    show('#auth-screen', true);
    $('#auth-login').focus();
  }

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const login = $('#auth-login').value.trim();
    const password = $('#auth-password').value;
    const error = $('#auth-error');
    error.textContent = '';
    if (authMode === 'setup' && password !== $('#auth-confirm').value) {
      error.textContent = 'As senhas não conferem.';
      return;
    }
    const submit = $('#auth-submit');
    submit.disabled = true;
    try {
      const res = await Api.post(authMode === 'setup' ? '/auth/setup' : '/auth/login', { login, password });
      Api.setToken(res.token);
      $('#auth-form').reset();
      await start();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  async function start() {
    const [data, me] = await Promise.all([Api.get('/state'), Api.get('/auth/me')]);
    state = data;
    $('#account-login').textContent = me.login;
    show('#boot-screen', false);
    show('#auth-screen', false);
    document.body.classList.remove('locked');
    renderAll();
    offerLocalMigration();
  }

  // Dados que ficaram no navegador da versão sem servidor: oferece enviar para a conta (uma vez).
  async function offerLocalMigration() {
    const local = Legacy.readLocal();
    if (!local || state.players.length || localStorage.getItem('futebol:migration-asked')) return;
    localStorage.setItem('futebol:migration-asked', '1');
    const ok = await importData(
      local,
      (p) => `Encontrei ${p.players.length} jogadores salvos neste aparelho (versão antiga). Enviar para a sua conta?`
    );
    if (ok) {
      Legacy.clearLocal();
      toast('Dados deste aparelho enviados para a conta.');
    }
  }

  Api.onUnauthorized = () => {
    if (!state) return;
    toast('Sua sessão expirou. Entre de novo.');
    showAuth();
  };

  $('#logout-btn').addEventListener('click', async () => {
    if (!confirm('Sair da conta neste aparelho?')) return;
    try {
      await Api.post('/auth/logout');
    } catch {
      /* mesmo se falhar, sai localmente */
    }
    Api.setToken(null);
    showAuth();
  });

  $('#boot-retry').addEventListener('click', boot);

  boot();
})();
