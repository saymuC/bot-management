// @ts-check
/**
 * Cooldown e assinaturas recentes, em memória.
 *
 * Ficam em RAM de propósito. Uma coluna `last_xp_at` no banco significaria uma
 * escrita em disco por mensagem de todo servidor com Levels ligado, para guardar
 * um dado que vive 60 segundos. O custo de estar em memória é que reiniciar o bot
 * libera uma concessão antecipada de XP por usuário — irrelevante ao lado disso.
 *
 * Como todo Map de longa duração no projeto (tracker do AutoMod, rascunhos do
 * /bot-status), há varredura e teto. Sem eles, cada usuário que já falou uma vez
 * ficaria na memória para sempre — e num bot em muitos servidores isso não é uma
 * abstração, é o processo crescendo até morrer.
 */

/** Intervalo da varredura que joga fora entradas vencidas. */
const SWEEP_INTERVAL_MS = 60 * 1000;

/** Teto de usuários rastreados. Estourar isso descarta os mais antigos. */
const MAX_TRACKED_USERS = 20_000;

/** Assinaturas guardadas por usuário. Poucas: só interessa "repetiu agora". */
const MAX_SIGNATURES_PER_USER = 5;

/** `guildId:userId` -> timestamp em que o cooldown termina. */
const cooldowns = new Map();

/** `guildId:userId` -> assinaturas recentes, da mais antiga para a mais nova. */
const signatures = new Map();

const keyOf = (guildId, userId) => `${guildId}:${userId}`;

/**
 * O usuário ainda está em cooldown?
 * @returns {boolean}
 */
function isOnCooldown(guildId, userId, now = Date.now()) {
  const until = cooldowns.get(keyOf(guildId, userId));
  return typeof until === 'number' && until > now;
}

/** Quantos ms faltam do cooldown (0 quando já venceu). */
function cooldownRemaining(guildId, userId, now = Date.now()) {
  const until = cooldowns.get(keyOf(guildId, userId));
  return typeof until === 'number' ? Math.max(0, until - now) : 0;
}

/**
 * Inicia o cooldown do usuário.
 *
 * Chamado **depois** de a gravação de XP ter sucesso, nunca antes: marcar
 * primeiro e falhar a gravação faria o usuário perder a mensagem inteira, sem XP
 * e sem direito a tentar de novo pelo próximo minuto.
 */
function markCooldown(guildId, userId, cooldownSeconds, now = Date.now()) {
  const key = keyOf(guildId, userId);
  cooldowns.set(key, now + Math.max(0, cooldownSeconds) * 1000);
  enforceCeiling(cooldowns);
  return key;
}

/**
 * A assinatura repete algo que o usuário mandou dentro da janela?
 *
 * Janela 0 desliga a checagem — é um valor legítimo para quem não quer a trava.
 *
 * @returns {boolean}
 */
function isRepeat(guildId, userId, signature, repeatWindowSeconds, now = Date.now()) {
  if (!signature || repeatWindowSeconds <= 0) return false;

  const cutoff = now - repeatWindowSeconds * 1000;
  const recent = signatures.get(keyOf(guildId, userId)) ?? [];
  return recent.some((entry) => entry.signature === signature && entry.at > cutoff);
}

/** Guarda a assinatura como "vista agora". */
function rememberSignature(guildId, userId, signature, now = Date.now()) {
  if (!signature) return;

  const key = keyOf(guildId, userId);
  const recent = (signatures.get(key) ?? []).filter((entry) => entry.signature !== signature);

  recent.push({ signature, at: now });
  // Corta pelo começo: a assinatura mais nova é sempre a mais importante de manter.
  signatures.set(key, recent.slice(-MAX_SIGNATURES_PER_USER));
  enforceCeiling(signatures);
}

/**
 * Teto real do Map: um flood distribuído entre milhares de usuários não pode
 * crescer a memória sem parar só porque a varredura ainda não passou.
 *
 * Remove pela ordem de inserção do Map, que é a aproximação mais barata de
 * "entrada mais antiga" — o alternativo seria ordenar o Map inteiro a cada
 * mensagem, o que custa muito mais do que a precisão vale aqui.
 */
function enforceCeiling(map) {
  if (map.size <= MAX_TRACKED_USERS) return;

  const excess = map.size - MAX_TRACKED_USERS;
  let removed = 0;
  for (const key of map.keys()) {
    map.delete(key);
    removed += 1;
    if (removed >= excess) break;
  }
}

/**
 * Remove cooldowns vencidos e assinaturas velhas.
 * @returns {number} entradas removidas
 */
function sweep(now = Date.now()) {
  let removed = 0;

  for (const [key, until] of cooldowns) {
    if (until <= now) {
      cooldowns.delete(key);
      removed += 1;
    }
  }

  // A retenção das assinaturas é o maior `repeatWindowSeconds` possível (1h); a
  // janela real de cada servidor é aplicada na leitura, em `isRepeat`.
  const cutoff = now - 3600 * 1000;
  for (const [key, entries] of signatures) {
    const kept = entries.filter((entry) => entry.at > cutoff);
    if (kept.length) signatures.set(key, kept);
    else {
      signatures.delete(key);
      removed += 1;
    }
  }

  return removed;
}

/** Esquece tudo de um servidor — usado ao resetar o ranking inteiro. */
function clearGuild(guildId) {
  const prefix = `${guildId}:`;
  for (const key of cooldowns.keys()) if (key.startsWith(prefix)) cooldowns.delete(key);
  for (const key of signatures.keys()) if (key.startsWith(prefix)) signatures.delete(key);
}

/** Esquece um usuário — usado quando um admin zera o XP dele. */
function clearUser(guildId, userId) {
  const key = keyOf(guildId, userId);
  cooldowns.delete(key);
  signatures.delete(key);
}

// unref() para a varredura não segurar o processo vivo — importa nos testes, que
// carregam este módulo e terminam sem desligar nada.
const sweepTimer = setInterval(() => sweep(), SWEEP_INTERVAL_MS);
sweepTimer.unref();

/** Só para os testes: começa de um estado limpo. */
function resetTracker() {
  cooldowns.clear();
  signatures.clear();
}

module.exports = {
  SWEEP_INTERVAL_MS,
  MAX_TRACKED_USERS,
  MAX_SIGNATURES_PER_USER,
  isOnCooldown,
  cooldownRemaining,
  markCooldown,
  isRepeat,
  rememberSignature,
  sweep,
  clearGuild,
  clearUser,
  resetTracker,
  /** Só para o teste conferir que os tetos são respeitados. */
  sizes: () => ({ cooldowns: cooldowns.size, signatures: signatures.size }),
};
