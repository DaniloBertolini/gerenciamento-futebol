// Sorteio equilibrado de times (só jogadores de linha; goleiros ficam fixos no gol, fora dos times).
//
// 1. Embaralha os jogadores e ordena por nível (desempate aleatório entre mesmo nível).
// 2. Distribui em rodadas: cada jogador vai para o time com menos jogadores e,
//    entre esses, o de menor soma de níveis (garante tamanhos iguais ±1).
// 3. Refina com trocas 1-a-1 entre times enquanto a diferença de força diminuir.
//
// Como os empates são aleatórios, cada sorteio gera times diferentes, mas sempre equilibrados.
(function (root) {
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const sum = (team) => team.reduce((acc, p) => acc + p.level, 0);

  // Soma dos quadrados dos desvios da média: quanto menor, mais equilibrado.
  function imbalance(totals) {
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    return totals.reduce((acc, t) => acc + (t - mean) ** 2, 0);
  }

  function drawTeams(players, numTeams) {
    if (numTeams < 2) throw new Error('É preciso pelo menos 2 times.');
    if (players.length < numTeams) throw new Error('Jogadores insuficientes para essa quantidade de times.');

    const ordered = shuffle(players).sort((a, b) => b.level - a.level);
    const teams = Array.from({ length: numTeams }, () => []);

    for (const player of ordered) {
      const minSize = Math.min(...teams.map((t) => t.length));
      const candidates = teams.filter((t) => t.length === minSize);
      const minSum = Math.min(...candidates.map(sum));
      const best = candidates.filter((t) => sum(t) === minSum);
      best[Math.floor(Math.random() * best.length)].push(player);
    }

    // Refinamento por trocas.
    for (let iter = 0; iter < 100; iter++) {
      const totals = teams.map(sum);
      const current = imbalance(totals);
      let improved = false;

      for (let a = 0; a < numTeams && !improved; a++) {
        for (let b = a + 1; b < numTeams && !improved; b++) {
          for (const i of shuffle([...teams[a].keys()])) {
            for (const j of shuffle([...teams[b].keys()])) {
              const diff = teams[a][i].level - teams[b][j].level;
              if (diff === 0) continue;
              const next = totals.slice();
              next[a] -= diff;
              next[b] += diff;
              if (imbalance(next) < current - 1e-9) {
                [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]];
                improved = true;
                break;
              }
            }
            if (improved) break;
          }
        }
      }
      if (!improved) break;
    }

    // Ordena os jogadores de cada time por nível para exibição.
    return shuffle(teams).map((t) => t.sort((x, y) => y.level - x.level || x.name.localeCompare(y.name)));
  }

  root.Draw = { drawTeams, sum };
  if (typeof module !== 'undefined') module.exports = root.Draw;
})(typeof window !== 'undefined' ? window : globalThis);
