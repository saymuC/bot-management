/**
 * Testes do repositório e do service de XP.
 *
 * Este bloco toca o banco de verdade (`database/bot.sqlite`), porque o
 * repositório usa statements preparados e a atomicidade da alteração é
 * justamente o que precisa ser verificado. Tudo grava sob `guild_id` reservados
 * que não são snowflakes, e a limpeza roda no `before` e no `after` — nenhum dado
 * de servidor real é encostado.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const repository = require('../utils/levels/repository');
const { changeXp, setUserLevel, resetUserXp, getUserState } = require('../utils/levels/service');
const { totalXpForLevel, calculateLevelFromXp, MAX_TOTAL_XP } = require('../utils/levels/formula');

const GUILD = 'test-levels-service';
const OTHER_GUILD = 'test-levels-service-2';
const USER = 'test-user-a';

const cleanup = () => {
  repository.deleteGuild(GUILD);
  repository.deleteGuild(OTHER_GUILD);
};

test.before(cleanup);
test.after(cleanup);

test('quem nunca pontuou lê 0 sem criar registro', (t) => {
  t.after(cleanup);

  assert.equal(repository.getXp(GUILD, 'nunca-falou'), 0);
  assert.equal(repository.participantCount(GUILD), 0, 'a leitura não cria linha');
  assert.deepEqual(getUserState(GUILD, 'nunca-falou'), { totalXp: 0, level: 0 });
});

test('o primeiro XP cria o registro', (t) => {
  t.after(cleanup);

  const change = changeXp({ guildId: GUILD, userId: USER, operation: 'add', amount: 20 });

  assert.equal(change.previousXp, 0);
  assert.equal(change.totalXp, 20);
  assert.equal(change.delta, 20);
  assert.equal(change.previousLevel, 0);
  assert.equal(change.newLevel, 0);
  assert.equal(change.direction, 'same');
  assert.equal(repository.participantCount(GUILD), 1);
});

test('adições sucessivas acumulam a partir do valor lido na transação', (t) => {
  t.after(cleanup);

  // O ponto do resolver: o `+15` continua sendo `+15` dentro da transação, em vez
  // de um total calculado antes com uma leitura que pode ter envelhecido.
  for (let i = 0; i < 10; i += 1) changeXp({ guildId: GUILD, userId: USER, operation: 'add', amount: 15 });
  assert.equal(repository.getXp(GUILD, USER), 150);
});

test('level-up é reportado com a direção e os níveis atravessados', (t) => {
  t.after(cleanup);

  changeXp({ guildId: GUILD, userId: USER, operation: 'set', amount: 99 });
  const change = changeXp({ guildId: GUILD, userId: USER, operation: 'add', amount: 1 });

  assert.equal(change.previousLevel, 0);
  assert.equal(change.newLevel, 1);
  assert.equal(change.direction, 'up');
  assert.deepEqual(change.crossedLevels, [1]);
});

test('salto de vários níveis reporta todos os níveis cruzados', (t) => {
  t.after(cleanup);

  setUserLevel({ guildId: GUILD, userId: USER, level: 4 });
  const change = setUserLevel({ guildId: GUILD, userId: USER, level: 10 });

  assert.equal(change.previousLevel, 4);
  assert.equal(change.newLevel, 10);
  assert.deepEqual(change.crossedLevels, [5, 6, 7, 8, 9, 10]);
});

test('remover XP nunca deixa o total negativo', (t) => {
  t.after(cleanup);

  changeXp({ guildId: GUILD, userId: USER, operation: 'add', amount: 50 });
  const change = changeXp({ guildId: GUILD, userId: USER, operation: 'remove', amount: 999_999 });

  assert.equal(change.totalXp, 0);
  assert.equal(repository.getXp(GUILD, USER), 0);
});

test('adicionar XP não passa do teto', (t) => {
  t.after(cleanup);

  const change = changeXp({ guildId: GUILD, userId: USER, operation: 'add', amount: MAX_TOTAL_XP * 3 });
  assert.equal(change.totalXp, MAX_TOTAL_XP);
});

test('set-level grava o XP mínimo do nível pedido', (t) => {
  t.after(cleanup);

  for (const level of [0, 1, 5, 10, 137]) {
    const change = setUserLevel({ guildId: GUILD, userId: USER, level });
    assert.equal(change.totalXp, totalXpForLevel(level), `nível ${level}`);
    assert.equal(change.newLevel, level, 'o nível derivado bate com o pedido');
    assert.equal(calculateLevelFromXp(change.totalXp), level);
  }
});

test('reset zera e reporta a queda', (t) => {
  t.after(cleanup);

  setUserLevel({ guildId: GUILD, userId: USER, level: 12 });
  const change = resetUserXp({ guildId: GUILD, userId: USER });

  assert.equal(change.totalXp, 0);
  assert.equal(change.previousLevel, 12);
  assert.equal(change.newLevel, 0);
  assert.equal(change.direction, 'down');
});

test('operação inválida e ids ausentes lançam em vez de gravar errado', () => {
  assert.throws(() => changeXp({ guildId: GUILD, userId: USER, operation: 'multiplicar', amount: 1 }));
  assert.throws(() => changeXp({ guildId: '', userId: USER, operation: 'add', amount: 1 }));
  assert.throws(() => changeXp({ guildId: GUILD, userId: '', operation: 'add', amount: 1 }));
});

test('o XP de um servidor não vaza para outro', (t) => {
  t.after(cleanup);

  changeXp({ guildId: GUILD, userId: USER, operation: 'add', amount: 100 });
  assert.equal(repository.getXp(OTHER_GUILD, USER), 0);
  assert.equal(repository.participantCount(OTHER_GUILD), 0);
});

test('o leaderboard ordena por XP e desempata de forma estável', (t) => {
  t.after(cleanup);

  // Mesmo XP em três usuários: sem o desempate por user_id, a ordem entre eles
  // mudaria de página para página e alguém apareceria duas vezes.
  changeXp({ guildId: GUILD, userId: 'user-b', operation: 'set', amount: 500 });
  changeXp({ guildId: GUILD, userId: 'user-a', operation: 'set', amount: 500 });
  changeXp({ guildId: GUILD, userId: 'user-c', operation: 'set', amount: 500 });
  changeXp({ guildId: GUILD, userId: 'user-top', operation: 'set', amount: 900 });

  const page = repository.leaderboardPage(GUILD, 10, 0);
  assert.deepEqual(
    page.map((row) => row.user_id),
    ['user-top', 'user-a', 'user-b', 'user-c']
  );
});

test('a paginação não repete nem perde ninguém', (t) => {
  t.after(cleanup);

  for (let i = 0; i < 25; i += 1) {
    changeXp({ guildId: GUILD, userId: `p-${String(i).padStart(2, '0')}`, operation: 'set', amount: 1000 - i });
  }

  const seen = [];
  for (let offset = 0; offset < 30; offset += 10) {
    seen.push(...repository.leaderboardPage(GUILD, 10, offset).map((row) => row.user_id));
  }

  assert.equal(seen.length, 25);
  assert.equal(new Set(seen).size, 25, 'ninguém aparece duas vezes');
});

test('a posição individual concorda com a ordem do leaderboard', (t) => {
  t.after(cleanup);

  changeXp({ guildId: GUILD, userId: 'user-b', operation: 'set', amount: 500 });
  changeXp({ guildId: GUILD, userId: 'user-a', operation: 'set', amount: 500 });
  changeXp({ guildId: GUILD, userId: 'user-top', operation: 'set', amount: 900 });

  const page = repository.leaderboardPage(GUILD, 10, 0);
  page.forEach((row, index) => {
    assert.equal(repository.rankOf(GUILD, row.user_id), index + 1, `posição de ${row.user_id}`);
  });
});

test('deleteUser remove só a linha pedida', (t) => {
  t.after(cleanup);

  changeXp({ guildId: GUILD, userId: 'user-a', operation: 'set', amount: 100 });
  changeXp({ guildId: GUILD, userId: 'user-b', operation: 'set', amount: 100 });

  assert.equal(repository.deleteUser(GUILD, 'user-a'), 1);
  assert.equal(repository.getXp(GUILD, 'user-a'), 0);
  assert.equal(repository.getXp(GUILD, 'user-b'), 100);
});

test('a linha sobrevive ao usuário sair do servidor', (t) => {
  t.after(cleanup);

  // Nada no módulo apaga o registro em `guildMemberRemove`: quem volta reencontra
  // o progresso, e apagar seria perder dado que não pode ser reconstruído.
  changeXp({ guildId: GUILD, userId: 'user-que-saiu', operation: 'set', amount: 777 });
  assert.equal(repository.getXp(GUILD, 'user-que-saiu'), 777);
});
