// Aba Pagamentos: cobrança do jogo atual. O valor do campo é dividido igualmente
// entre quem jogou (goleiros inclusos) e arredondado para cima no real inteiro.
(function (root) {
  const DEFAULT_TOTAL = 150;

  const METHODS = {
    dinheiro: { label: 'Dinheiro', icon: '💵' },
    pix: { label: 'Pix', icon: '⚡' },
    cartao: { label: 'Cartão', icon: '💳' },
    pago: { label: 'Pago', icon: '✓' }, // pagamentos antigos, sem forma registrada
  };
  const CHOOSABLE = ['dinheiro', 'pix', 'cartao'];

  const ICON_TRASH =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/></svg>';

  // 150 / 16 = 9,375 → R$ 10. O arredondamento em centavos evita erro de ponto flutuante.
  function perPerson(total, count) {
    if (!count) return 0;
    return Math.ceil(Math.round((total / count) * 100) / 100);
  }

  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const money = (v) => (Number.isInteger(v) ? brl.format(v).replace(/,00$/, '') : brl.format(v));

  const formatDate = (iso) =>
    new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });

  // Reduz a imagem (fica leve para salvar no servidor) sem perder a leitura do QR Code.
  function imageToDataUrl(file, maxSize = 800) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const g = canvas.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        let data = canvas.toDataURL('image/png');
        if (data.length > 1_500_000) data = canvas.toDataURL('image/jpeg', 0.92);
        resolve(data);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Imagem inválida.'));
      };
      img.src = url;
    });
  }

  function init(ctx) {
    const { getState, api, run, FAIL, toast, escapeHtml } = ctx;
    const $ = (sel) => document.querySelector(sel);

    // Na cobrança, "id" é a linha da cobrança e "playerId" o jogador do cadastro (null se foi excluído).
    const liveName = (p) => (getState().players.find((x) => x.id === p.playerId) || p).name;
    const byName = (a, b) => liveName(a).localeCompare(liveName(b), 'pt-BR');

    /** Aplica a cobrança devolvida pela API e redesenha. */
    async function update(call) {
      const game = await run(call);
      if (game === FAIL) return false;
      getState().game = game;
      render();
      return true;
    }

    // ---------------- Criar cobrança ----------------
    function marked() {
      const s = getState();
      return s.players.filter((p) => s.selectedIds.includes(p.id));
    }

    function renderForm() {
      const game = getState().game;
      const form = $('#game-form');
      // Com cobrança em andamento, o formulário vai para baixo dela (serve para o próximo jogo).
      if (game) $('#game').after(form);
      else $('#game').before(form);
      $('#game-form-title').textContent = game ? 'Próximo jogo' : 'Cobrança do jogo';
      $('#game-submit').textContent = game ? 'Nova cobrança' : 'Criar cobrança';
      $('#game-submit').classList.toggle('primary', !game);
      renderPreview();
    }

    function renderPreview() {
      const list = marked();
      const total = Number($('#game-total').value) || 0;
      let text;
      if (!list.length) text = 'Marque quem jogou na aba "Sorteio" — a cobrança usa essa lista.';
      else {
        text = `${list.length} marcados no sorteio`;
        if (total > 0) {
          const each = perPerson(total, list.length);
          const exact = total / list.length;
          text += ` · ${money(each)} por pessoa`;
          if (each !== exact) text += ` (${brl.format(exact)} arredondado)`;
        }
      }
      $('#game-preview').textContent = text;
      $('#game-submit').disabled = !list.length;
    }

    $('#game-total').addEventListener('input', renderPreview);

    $('#game-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const s = getState();
      const total = Number($('#game-total').value);
      const players = marked();
      if (!(total > 0) || !players.length) return;
      if (s.game) {
        const pending = s.game.players.filter((p) => !p.method).length;
        const msg = pending
          ? `A cobrança atual ainda tem ${pending} pendente(s). Substituir mesmo assim?`
          : 'Substituir a cobrança atual por uma nova?';
        if (!confirm(msg)) return;
      }
      const submit = $('#game-submit');
      submit.disabled = true;
      const ok = await update(() => api.post('/game', { total, playerIds: players.map((p) => p.id) }));
      submit.disabled = false;
      if (!ok) return;
      $('#game-total').value = DEFAULT_TOTAL;
      renderPreview();
      toast('Cobrança criada.');
    });

    // ---------------- Cobrança atual ----------------
    // Escolher uma opção já marca a pessoa como paga.
    function methodSelect(p) {
      return `<select class="pay-select" data-pay="${p.id}" aria-label="Forma de pagamento de ${escapeHtml(liveName(p))}">
        <option value="">Pagar</option>
        ${CHOOSABLE.map((m) => `<option value="${m}">${METHODS[m].icon} ${METHODS[m].label}</option>`).join('')}
      </select>`;
    }

    function renderGame() {
      const s = getState();
      const g = s.game;
      if (!g) {
        $('#game').innerHTML = '';
        return;
      }
      const count = g.players.length;
      const each = perPerson(g.total, count);
      const exact = count ? g.total / count : 0;
      const collected = each * count;
      const pending = g.players.filter((p) => !p.method).sort(byName);
      const paid = g.players.filter((p) => p.method).sort(byName);
      const pct = count ? Math.round((paid.length / count) * 100) : 0;

      const byMethod = Object.keys(METHODS)
        .map((m) => ({ m, n: paid.filter((p) => p.method === m).length }))
        .filter((x) => x.n);

      const inGame = new Set(g.players.map((p) => p.playerId));
      const addable = s.players.filter((p) => !inGame.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

      const done = count > 0 && !pending.length;
      const status = !count ? 'Sem jogadores' : done ? '✅ Tudo pago' : `${paid.length}/${count} pagos`;

      $('#game').innerHTML = `
      <div class="card game ${done ? 'done' : ''}">
        <div class="game-sum">
          <h2>Jogo de ${formatDate(g.createdAt)}</h2>
          <span class="game-sum-status">${status}</span>
        </div>
        <div class="progress"><span style="width:${pct}%"></span></div>

        <div class="game-total-row">
          <label class="field">
            <span>Valor total (R$)</span>
            <input type="number" min="0" step="0.01" inputmode="decimal" value="${g.total}" data-game-total />
          </label>
          ${s.settings.pixQr ? '<button type="button" class="btn" data-show-qr>⚡ Mostrar QR Pix</button>' : ''}
        </div>
        <p class="game-calc">
          ${count} pessoas · <strong>${money(each)} cada</strong>
          ${each !== exact ? ` · ${brl.format(exact)} arredondado, sobra ${money(Math.round((collected - g.total) * 100) / 100)}` : ''}
          <br />Recebido <strong>${money(paid.length * each)}</strong> de ${money(collected)}
        </p>
        ${
          byMethod.length
            ? `<div class="method-summary">${byMethod
                .map(({ m, n }) => `<span class="method-chip method-${m}">${METHODS[m].icon} ${METHODS[m].label}: ${money(n * each)} <small>(${n})</small></span>`)
                .join('')}</div>`
            : ''
        }

        ${
          pending.length
            ? `<h3 class="pay-heading">Faltam pagar <span class="badge">${pending.length}</span></h3>
               <ul class="pay-list">
                 ${pending
                   .map(
                     (p) => `
                   <li class="pay-item pending">
                     <span class="player-name">${escapeHtml(liveName(p))}</span>
                     <span class="pay-status">${money(each)}</span>
                     ${methodSelect(p)}
                     <button type="button" class="icon-btn" data-remove-player="${p.id}" title="Tirar da cobrança">✕</button>
                   </li>`
                   )
                   .join('')}
               </ul>`
            : ''
        }

        ${
          paid.length
            ? `<h3 class="pay-heading">Pagos <span class="badge">${paid.length}</span></h3>
               <ul class="pay-list">
                 ${paid
                   .map(
                     (p) => `
                   <li class="pay-item">
                     <button type="button" class="pay-row paid" data-undo="${p.id}" title="Toque para desfazer">
                       <span class="pay-check">✓</span>
                       <span class="player-name">${escapeHtml(liveName(p))}</span>
                       <span class="method-chip method-${p.method}">${METHODS[p.method].icon} ${METHODS[p.method].label}</span>
                     </button>
                   </li>`
                   )
                   .join('')}
               </ul>`
            : ''
        }

        ${
          addable.length
            ? `<select class="add-select" data-add-select aria-label="Adicionar jogador">
                 <option value="">+ Adicionar alguém que jogou…</option>
                 ${addable.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
               </select>`
            : ''
        }

        <div class="game-footer">
          <button type="button" class="btn ghost danger small" data-delete-game>${ICON_TRASH} Excluir cobrança</button>
        </div>
      </div>`;
    }

    /** Muda a forma de pagamento na hora (otimista) e confirma com o servidor. */
    function setMethod(entry, method) {
      entry.method = method;
      render();
      update(() => api.patch(`/game/players/${entry.id}`, { method }));
    }

    const container = $('#game');

    container.addEventListener('click', async (e) => {
      const g = getState().game;
      if (!g) return;
      const find = (id) => g.players.find((p) => p.id === id);

      const undo = e.target.closest('[data-undo]');
      const remove = e.target.closest('[data-remove-player]');

      if (undo) {
        const p = find(undo.dataset.undo);
        if (confirm(`Desfazer o pagamento de ${liveName(p)}?`)) setMethod(p, null);
      } else if (remove) {
        const p = find(remove.dataset.removePlayer);
        if (!confirm(`Tirar ${liveName(p)} desta cobrança? O valor por pessoa será recalculado.`)) return;
        await update(() => api.del(`/game/players/${p.id}`));
      } else if (e.target.closest('[data-show-qr]')) {
        showQr();
      } else if (e.target.closest('[data-delete-game]')) {
        const pending = g.players.filter((p) => !p.method).length;
        const msg = pending
          ? `Excluir a cobrança? Ainda tem ${pending} pendente(s).`
          : 'Excluir a cobrança deste jogo?';
        if (!confirm(msg)) return;
        if ((await run(() => api.del('/game'))) === FAIL) return;
        getState().game = null;
        render();
        toast('Cobrança excluída.');
      }
    });

    container.addEventListener('change', async (e) => {
      const g = getState().game;
      if (!g) return;
      if (e.target.matches('[data-pay]') && CHOOSABLE.includes(e.target.value)) {
        const p = g.players.find((x) => x.id === e.target.dataset.pay);
        setMethod(p, e.target.value);
        toast(`${liveName(p)}: pago no ${METHODS[p.method].label.toLowerCase()}.`);
      } else if (e.target.matches('[data-game-total]')) {
        const total = Number(e.target.value);
        if (!(total > 0)) {
          toast('Informe um valor maior que zero.');
          render();
          return;
        }
        await update(() => api.patch('/game', { total }));
      } else if (e.target.matches('[data-add-select]') && e.target.value) {
        await update(() => api.post('/game/players', { playerId: e.target.value }));
      }
    });

    // ---------------- QR Code do Pix ----------------
    function renderPix() {
      const { pixQr, pixKey } = getState().settings;
      if (document.activeElement !== $('#pix-key')) $('#pix-key').value = pixKey || '';
      $('#pix-qr-area').innerHTML = pixQr
        ? `<button type="button" class="pix-qr-thumb" data-show-qr title="Mostrar em tela cheia">
             <img src="${pixQr}" alt="QR Code do Pix" />
           </button>
           <div class="form-actions">
             <button type="button" class="btn primary" data-show-qr>Mostrar em tela cheia</button>
             <label class="btn">Trocar imagem<input type="file" accept="image/*" data-qr-input hidden /></label>
             <button type="button" class="btn ghost danger" data-qr-remove>Remover</button>
           </div>`
        : `<p class="muted">
             No app do seu banco, vá em <strong>Pix → Receber</strong> (ou "Meu QR Code"), salve ou tire print do QR Code
             e envie aqui. Se for print, recorte deixando só o QR Code.
           </p>
           <label class="btn primary">Enviar imagem do QR Code<input type="file" accept="image/*" data-qr-input hidden /></label>`;
    }

    function showQr() {
      const s = getState();
      if (!s.settings.pixQr) return;
      $('#qr-overlay-img').src = s.settings.pixQr;
      const g = s.game;
      $('#qr-overlay-value').textContent = g && g.players.length ? `${money(perPerson(g.total, g.players.length))} por pessoa` : '';
      $('#qr-overlay-key').textContent = s.settings.pixKey ? `Chave: ${s.settings.pixKey}` : '';
      $('#qr-overlay').classList.remove('hidden');
    }

    $('#qr-close').addEventListener('click', () => $('#qr-overlay').classList.add('hidden'));
    $('#qr-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'qr-overlay') $('#qr-overlay').classList.add('hidden');
    });

    async function saveQr(pixQr) {
      if ((await run(() => api.patch('/settings', { pixQr }))) === FAIL) return false;
      getState().settings.pixQr = pixQr || '';
      render();
      return true;
    }

    $('#pix-qr-area').addEventListener('click', async (e) => {
      if (e.target.closest('[data-show-qr]')) showQr();
      if (e.target.closest('[data-qr-remove]') && confirm('Remover o QR Code do Pix?')) await saveQr(null);
    });

    $('#pix-qr-area').addEventListener('change', async (e) => {
      if (!e.target.matches('[data-qr-input]')) return;
      const file = e.target.files[0];
      if (!file) return;
      let dataUrl;
      try {
        dataUrl = await imageToDataUrl(file);
      } catch {
        toast('Não foi possível ler a imagem.');
        return;
      }
      if (await saveQr(dataUrl)) toast('QR Code salvo.');
    });

    $('#pix-key').addEventListener('change', async (e) => {
      const pixKey = e.target.value.trim();
      if ((await run(() => api.patch('/settings', { pixKey }))) === FAIL) return;
      getState().settings.pixKey = pixKey;
      toast('Chave Pix salva.');
    });

    function render() {
      renderGame();
      renderForm();
      renderPix();
    }

    return { render };
  }

  root.Payments = { init, perPerson };
  if (typeof module !== 'undefined') module.exports = root.Payments;
})(typeof window !== 'undefined' ? window : globalThis);
