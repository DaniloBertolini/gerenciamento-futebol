/** Compara nomes ignorando maiúsculas e acentos ("João" == "joao"). */
export const normalizeName = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
