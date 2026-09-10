/**
 * Cargos de recompensa.
 *
 * A ideia central: o sistema não "concede o cargo do nível novo", ele **reconcilia**
 * o conjunto de cargos que o membro deveria ter no nível atual. A diferença aparece
 * em dois casos que a concessão simples erra:
 *
 *   - salto de vários níveis. Quem vai do 4 ao 10 com recompensas em 5, 8 e 10
 *     precisa dos três, não só do 10;
 *   - queda de nível. `/remove-xp` e `/reset-xp` têm de **tirar** o que não vale
 *     mais, senão o cargo comprado com XP que já não existe fica para sempre.
 *
 * O sistema só mexe em cargos que estão cadastrados como recompensa. Um cargo que
 * o membro tem por outro motivo nunca é removido, mesmo no modo `highest` — o
 * escopo do módulo é o que ele mesmo distribui.
 */

const { PermissionFlagsBits } = require('discord.js');

/**
 * Todos os cargos que este sistema gerencia neste servidor.
 * @param {import('./types').LevelsConfig} config
 * @returns {Set<string>}
 */
function managedRoleIds(config) {
  return new Set(config.rewards.flatMap((reward) => reward.roleIds));
}

/**
 * Cargos que o membro deveria ter no nível informado.
 *
 * `stack` acumula tudo que ele já alcançou; `highest` mantém só a faixa mais alta.
 *
 * @param {import('./types').LevelsConfig} config
 * @param {number} level
 * @returns {Set<string>}
 */
function desiredRoleIds(config, level) {
  const reached = config.rewards.filter((reward) => reward.level <= level);
  if (!reached.length) return new Set();

  if (config.rewardMode === 'highest') {
    // `rewards` vem ordenado por nível pelo normalizador, então o último é o maior.
    const top = reached[reached.length - 1];
    return new Set(top.roleIds);
  }

  return new Set(reached.flatMap((reward) => reward.roleIds));
}

/**
 * O que precisa mudar nos cargos do membro. Função pura — é o que os testes usam.
 *
 * @param {Set<string>} desired cargos que deveria ter
 * @param {Set<string>} managed cargos que o sistema gerencia
 * @param {Iterable<string>} current cargos que o membro tem hoje
 * @returns {{ toAdd: string[], toRemove: string[] }}
 */
function reconcile(desired, managed, current) {
  const has = new Set(current);

  return {
    toAdd: [...desired].filter((roleId) => !has.has(roleId)),
    // Só cargos gerenciados entram na remoção: é a trava que impede o módulo de
    // tirar um cargo que não foi ele que deu.
    toRemove: [...has].filter((roleId) => managed.has(roleId) && !desired.has(roleId)),
  };
}

/**
 * Por que o bot não pode mexer neste cargo, ou null quando pode.
 * @param {import('discord.js').Guild} guild
 * @param {string} roleId
 * @returns {string|null}
 */
function roleBlockReason(guild, roleId) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return `<@&${roleId}> não existe mais`;
  // Cargo de integração (bot, booster) não pode ser atribuído por ninguém.
  if (role.managed) return `${role.name} é gerenciado por uma integração`;
  if (role.id === guild.id) return '@everyone não pode ser recompensa';

  const me = guild.members.me;
  if (me && role.position >= me.roles.highest.position) {
    return `${role.name} está acima do bot na hierarquia`;
  }
  return null;
}

/**
 * Aplica as recompensas do nível atual ao membro.
 *
 * Nada aqui lança: uma falha de cargo não pode derrubar o evento de mensagem nem
 * desfazer o XP que já foi gravado. Os problemas voltam em `problems`, para o
 * chamador logar.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {import('./types').LevelsConfig} config
 * @param {number} level
 * @param {string} [reason] motivo no audit log do Discord
 * @returns {Promise<{ added: string[], removed: string[], problems: string[] }>}
 */
async function syncMemberRewards(member, config, level, reason = 'Recompensa de nível') {
  const result = { added: [], removed: [], problems: [] };
  if (!config.rewards.length || !member?.guild) return result;

  const guild = member.guild;
  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    result.problems.push('o bot não tem a permissão Gerenciar Cargos');
    return result;
  }

  const { toAdd, toRemove } = reconcile(
    desiredRoleIds(config, level),
    managedRoleIds(config),
    member.roles.cache.keys()
  );
  if (!toAdd.length && !toRemove.length) return result;

  // Filtra antes de chamar a API: pedir um cargo inalcançável só rende um erro
  // 50013 que não diz qual cargo era.
  const usable = (roleIds) =>
    roleIds.filter((roleId) => {
      const block = roleBlockReason(guild, roleId);
      if (block) result.problems.push(block);
      return !block;
    });

  const addable = usable(toAdd);
  const removable = usable(toRemove);

  // Uma chamada por lote em vez de uma por cargo: são dois requests em vez de
  // seis quando o membro salta vários níveis de uma vez.
  if (addable.length) {
    try {
      await member.roles.add(addable, reason);
      result.added.push(...addable);
    } catch (err) {
      result.problems.push(`falha ao adicionar cargos: ${err.message}`);
    }
  }

  if (removable.length) {
    try {
      await member.roles.remove(removable, reason);
      result.removed.push(...removable);
    } catch (err) {
      result.problems.push(`falha ao remover cargos: ${err.message}`);
    }
  }

  return result;
}

module.exports = { managedRoleIds, desiredRoleIds, reconcile, roleBlockReason, syncMemberRewards };
