// @ts-check
/**
 * Cache em memória com TTL e teto, na forma que o resto do projeto já usa.
 *
 * Três coisas do card precisam disto: avatares decodificados, o fundo remoto e a
 * página do ranking já renderizada. Todas guardam objeto grande (bitmap, Buffer
 * de PNG) e todas são chaveadas por algo que o usuário controla — servidor,
 * página, URL de avatar. Sem teto e sem varredura, um bot em muitos servidores
 * não teria um cache, teria um vazamento com nome bonito.
 *
 * A chave do avatar e do fundo é a própria URL, o que funciona porque o CDN do
 * Discord põe o hash do arquivo no caminho: avatar trocado é URL nova, não
 * entrada velha servida por engano.
 */

/** @typedef {{ value: unknown, expiresAt: number }} CacheEntry */

/**
 * @template T
 * @param {{ ttlMs: number, max: number, sweepIntervalMs?: number }} options
 */
function createCache({ ttlMs, max, sweepIntervalMs = 60_000 }) {
  /** @type {Map<string, { value: T, expiresAt: number }>} */
  const entries = new Map();

  /**
   * @param {string} key
   * @returns {T|undefined}
   */
  function get(key, now = Date.now()) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      entries.delete(key);
      return undefined;
    }
    // Reinsere para a ordem do Map ser "menos recentemente usado primeiro", que é
    // a ordem em que o teto descarta.
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }

  /**
   * @param {string} key
   * @param {T} value
   */
  function set(key, value, now = Date.now()) {
    entries.delete(key);
    entries.set(key, { value, expiresAt: now + ttlMs });

    while (entries.size > max) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }

    return value;
  }

  /** Remove o que já venceu. @returns {number} entradas removidas */
  function sweep(now = Date.now()) {
    let removed = 0;
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  // unref() para a varredura não segurar o processo: os testes carregam este
  // módulo e terminam sem desligar nada.
  const timer = setInterval(() => sweep(), sweepIntervalMs);
  timer.unref();

  return {
    get,
    set,
    sweep,
    has: (/** @type {string} */ key) => get(key) !== undefined,
    clear: () => entries.clear(),
    size: () => entries.size,
  };
}

module.exports = { createCache };
