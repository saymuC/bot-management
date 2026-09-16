/** Fluxo real do ticketHandler: cliques antigos, corrida, permissões e falhas parciais. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');

const { db } = require('../database/db');
const { saveTicketConfig } = require('../utils/tickets/config');
const { routeTicketInteraction } = require('../handlers/ticketHandler');

const GUILD = '900000000000000001';
const USER = '900000000000000002';
const STAFF = '900000000000000003';
const OTHER = '900000000000000004';
const STAFF_ROLE = '900000000000000010';
const MANAGER_ROLE = '900000000000000011';
const LOG = '900000000000000020';

function cleanup() {
  db.prepare('DELETE FROM ticket_ratings WHERE guild_id = ?').run(GUILD);
  db.prepare('DELETE FROM tickets WHERE guild_id = ?').run(GUILD);
  db.prepare('DELETE FROM ticket_categories WHERE guild_id = ?').run(GUILD);
  db.prepare('DELETE FROM guild_config WHERE guild_id = ?').run(GUILD);
}

test.beforeEach(cleanup);
test.after(cleanup);

function seed({ maxOpenPerUser = 1, allowUserSoftClose = true, deleteDelaySeconds = 300, managerRoleIds = [] } = {}) {
  saveTicketConfig(GUILD, {
    enabled: true,
    maxOpenPerUser,
    logChannelId: LOG,
    permissions: { staffRoleIds: [STAFF_ROLE], managerRoleIds, allowUserSoftClose },
    behavior: { deleteDelaySeconds, createTranscript: true, sendRatingDm: true, allowReopen: true },
  });
  return db.prepare('INSERT INTO ticket_categories (guild_id, label, support_role_id) VALUES (?, ?, ?)').run(GUILD, 'Suporte', STAFF_ROLE).lastInsertRowid;
}

function member(id, roles = []) {
  return { guild: { id: GUILD }, permissions: { has: () => false }, roles: { cache: new Collection(roles.map((r) => [r, { id: r }])) }, id };
}

function makeGuild({ createFails = false, memberRoles = {} } = {}) {
  const created = [];
  const logChannel = { id: LOG, isTextBased: () => true, send: async (p) => (logChannel.sent.push(p), p), sent: [] };
  const guild = {
    id: GUILD,
    name: 'Guild Teste',
    roles: { everyone: { id: 'everyone' } },
    members: { fetch: async (id) => member(id, memberRoles[id] ?? []) },
    channels: {
      cache: new Collection([[LOG, logChannel]]),
      fetch: async (id) => guild.channels.cache.get(id) ?? null,
      create: async (data) => {
        if (createFails) throw new Error('Missing Permissions');
        const channel = makeChannel(`chan-${created.length + 1}`, guild, data.name);
        channel.createData = data;
        created.push(channel);
        guild.channels.cache.set(channel.id, channel);
        return channel;
      },
    },
  };
  guild.created = created;
  guild.logChannel = logChannel;
  return guild;
}

function makeChannel(id, guild, name = 'ticket') {
  const channel = {
    id,
    guild,
    name,
    parentId: null,
    deleted: false,
    sent: [],
    isTextBased: () => true,
    send: async (p) => (channel.sent.push(p), p),
    delete: async () => { channel.deleted = true; },
    permissionOverwrites: {
      edits: [],
      deletes: [],
      edit: async (...args) => channel.permissionOverwrites.edits.push(args),
      delete: async (...args) => channel.permissionOverwrites.deletes.push(args),
    },
    messages: { fetch: async () => new Collection() },
  };
  return channel;
}

function makeClient(guild) {
  return {
    users: { fetch: async (id) => ({ id, tag: `${id}#0001`, send: async (p) => p }) },
    guilds: { fetch: async (id) => (id === GUILD ? guild : null) },
  };
}

function interaction(customId, guild, channel, userId = USER, roles = [], extra = {}) {
  const calls = [];
  const user = { id: userId, username: `user-${userId}`, tag: `user-${userId}#0001`, toString: () => `<@${userId}>` };
  return {
    customId,
    guild,
    channel,
    user,
    member: member(userId, roles),
    client: makeClient(guild),
    values: [],
    calls,
    reply: async (p) => (calls.push(['reply', p]), p),
    update: async (p) => (calls.push(['update', p]), p),
    editReply: async (p) => (calls.push(['editReply', p]), p),
    deferUpdate: async () => calls.push(['deferUpdate']),
    showModal: async (p) => (calls.push(['showModal', p]), p),
    ...extra,
  };
}

function insertTicket({ channelId = 'chan-existing', userId = USER, status = 'open', claimedBy = null, categoryLabel = 'Suporte' } = {}) {
  const id = db.prepare('INSERT INTO tickets (guild_id, channel_id, user_id, category_label, status, claimed_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(GUILD, channelId, userId, categoryLabel, status, claimedBy).lastInsertRowid;
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
}

test('duplo clique na categoria cria só um ticket ativo por usuário/categoria', async () => {
  const categoryId = seed({ maxOpenPerUser: 5 });
  const guild = makeGuild();
  const first = interaction('ticket_select_category', guild, null, USER, [], { values: [String(categoryId)] });
  const second = interaction('ticket_select_category', guild, null, USER, [], { values: [String(categoryId)] });

  await Promise.all([routeTicketInteraction(first), routeTicketInteraction(second)]);

  assert.equal(db.prepare('SELECT COUNT(*) n FROM tickets WHERE guild_id = ? AND user_id = ?').get(GUILD, USER).n, 1);
  assert.equal(guild.created.length, 1);
});

test('user_closed ainda conta como ticket ativo no botão abrir', async () => {
  seed({ maxOpenPerUser: 1 });
  insertTicket({ status: 'user_closed' });
  const guild = makeGuild();
  const i = interaction('ticket_open', guild, makeChannel('panel', guild));

  await routeTicketInteraction(i);

  assert.equal(i.calls[0][0], 'reply');
  assert.match(i.calls[0][1].embeds[0].data.description, /máximo permitido/);
});

test('gerência entra nos overwrites do ticket e da call', async () => {
  const categoryId = seed({ managerRoleIds: [MANAGER_ROLE] });
  const guild = makeGuild();
  const open = interaction('ticket_select_category', guild, null, USER, [], { values: [String(categoryId)] });

  await routeTicketInteraction(open);

  const ticketOverwrites = guild.created[0].createData.permissionOverwrites.map((o) => o.id);
  assert.ok(ticketOverwrites.includes(STAFF_ROLE));
  assert.ok(ticketOverwrites.includes(MANAGER_ROLE));

  const ticket = db.prepare('SELECT * FROM tickets WHERE guild_id = ?').get(GUILD);
  const call = interaction(`ticket_admin_select_${ticket.id}`, guild, guild.created[0], STAFF, [MANAGER_ROLE], {
    values: ['create_call'],
  });

  await routeTicketInteraction(call);

  const callOverwrites = guild.created[1].createData.permissionOverwrites.map((o) => o.id);
  assert.ok(callOverwrites.includes(STAFF_ROLE));
  assert.ok(callOverwrites.includes(MANAGER_ROLE));
});

test('limite de tickets é revalidado ao selecionar categoria', async () => {
  const categoryId = seed({ maxOpenPerUser: 1 });
  const guild = makeGuild();
  const i = interaction('ticket_select_category', guild, null, USER, [], { values: [String(categoryId)] });
  insertTicket({ status: 'user_closed', categoryLabel: 'Financeiro' });

  await routeTicketInteraction(i);

  assert.equal(guild.created.length, 0);
  assert.match(i.calls.at(-1)[1].embeds[0].data.description, /máximo permitido/);
});

test('botão antigo não atua em outro ticket e permissão é revalidada no clique', async () => {
  seed();
  const guild = makeGuild();
  const old = insertTicket({ channelId: 'old', status: 'closed' });
  const current = insertTicket({ channelId: 'current' });
  const i = interaction(`ticket_claim_${old.id}`, guild, makeChannel('current', guild), STAFF, [STAFF_ROLE]);

  await routeTicketInteraction(i);

  assert.equal(db.prepare('SELECT claimed_by FROM tickets WHERE id = ?').get(current.id).claimed_by, null);
  assert.match(i.calls[0][1].embeds[0].data.description, /não encontrado|encerrado/);

  const noRole = interaction(`ticket_claim_${current.id}`, guild, i.channel, STAFF);
  await routeTicketInteraction(noRole);
  assert.match(noRole.calls[0][1].embeds[0].data.description, /equipe/);
});

test('claim, fechamento final e reabertura são idempotentes', async () => {
  seed({ deleteDelaySeconds: 300 });
  const guild = makeGuild();
  const channel = makeChannel('chan-existing', guild);
  const ticket = insertTicket();

  const a = interaction(`ticket_claim_${ticket.id}`, guild, channel, STAFF, [STAFF_ROLE]);
  const b = interaction(`ticket_claim_${ticket.id}`, guild, channel, OTHER, [STAFF_ROLE]);
  await routeTicketInteraction(a);
  await routeTicketInteraction(b);
  assert.equal(db.prepare('SELECT claimed_by FROM tickets WHERE id = ?').get(ticket.id).claimed_by, STAFF);

  const close1 = interaction(`ticket_close_${ticket.id}`, guild, channel, STAFF, [STAFF_ROLE]);
  const close2 = interaction(`ticket_close_${ticket.id}`, guild, channel, STAFF, [STAFF_ROLE]);
  await routeTicketInteraction(close1);
  await routeTicketInteraction(close2);
  assert.equal(db.prepare('SELECT status FROM tickets WHERE id = ?').get(ticket.id).status, 'closed');
  assert.match(close2.calls.at(-1)[1].embeds[0].data.description, /encerrado/);

  const reopened = insertTicket({ status: 'user_closed' });
  const reopen1 = interaction(`ticket_reopen_${reopened.id}`, guild, makeChannel('chan-existing', guild), STAFF, [STAFF_ROLE]);
  const reopen2 = interaction(`ticket_reopen_${reopened.id}`, guild, reopen1.channel, STAFF, [STAFF_ROLE]);
  await routeTicketInteraction(reopen1);
  await routeTicketInteraction(reopen2);
  assert.equal(db.prepare('SELECT status FROM tickets WHERE id = ?').get(reopened.id).status, 'open');
  assert.match(reopen2.calls.at(-1)[1].embeds[0].data.description, /aberto/);
});

test('falha ao criar canal desfaz a reserva no banco', async () => {
  const categoryId = seed();
  const guild = makeGuild({ createFails: true });
  const i = interaction('ticket_select_category', guild, null, USER, [], { values: [String(categoryId)] });

  await routeTicketInteraction(i);

  assert.equal(db.prepare('SELECT COUNT(*) n FROM tickets WHERE guild_id = ?').get(GUILD).n, 0);
});

test('canal/cargo/usuário removido não derruba add/remove/transfer', async () => {
  seed();
  const guild = makeGuild();
  const channel = makeChannel('chan-existing', guild);
  channel.permissionOverwrites.edit = async () => { throw new Error('unknown channel'); };
  channel.permissionOverwrites.delete = async () => { throw new Error('unknown overwrite'); };
  const ticket = insertTicket({ claimedBy: STAFF });

  const add = interaction(`ticket_admin_add_${ticket.id}`, guild, channel, STAFF, [STAFF_ROLE], { values: [OTHER] });
  await routeTicketInteraction(add);
  assert.match(add.calls.at(-1)[1].embeds[0].data.description, /0/);

  const remove = interaction(`ticket_admin_remove_${ticket.id}`, guild, channel, STAFF, [STAFF_ROLE], { values: [OTHER] });
  await routeTicketInteraction(remove);
  assert.match(remove.calls.at(-1)[1].embeds[0].data.description, /0/);

  const transfer = interaction(`ticket_admin_transfer_${ticket.id}`, guild, channel, STAFF, [STAFF_ROLE], { values: [OTHER] });
  await routeTicketInteraction(transfer);
  assert.match(transfer.calls.at(-1)[1].embeds[0].data.description, /não faz parte da equipe/);
});

test('transferência e alteração de membros sem permissão são recusadas', async () => {
  seed();
  const guild = makeGuild({ memberRoles: { [OTHER]: [STAFF_ROLE] } });
  const channel = makeChannel('chan-existing', guild);
  const ticket = insertTicket({ claimedBy: STAFF });

  for (const [customId, values] of [
    [`ticket_admin_add_${ticket.id}`, [OTHER]],
    [`ticket_admin_remove_${ticket.id}`, [OTHER]],
    [`ticket_admin_transfer_${ticket.id}`, [OTHER]],
  ]) {
    const i = interaction(customId, guild, channel, USER, [], { values });
    await routeTicketInteraction(i);
    assert.match(i.calls[0][1].embeds[0].data.description, /equipe/);
  }
  assert.equal(db.prepare('SELECT claimed_by FROM tickets WHERE id = ?').get(ticket.id).claimed_by, STAFF);
});

test('falha ao gerar transcript não impede fechamento', async () => {
  seed({ deleteDelaySeconds: 300 });
  const guild = makeGuild();
  const channel = makeChannel('chan-existing', guild);
  channel.messages.fetch = async () => { throw new Error('Missing Access'); };
  const ticket = insertTicket({ claimedBy: STAFF });

  await routeTicketInteraction(interaction(`ticket_close_${ticket.id}`, guild, channel, STAFF, [STAFF_ROLE]));

  assert.equal(db.prepare('SELECT status FROM tickets WHERE id = ?').get(ticket.id).status, 'closed');
  assert.deepEqual(guild.logChannel.sent.at(-1).files, []);
});

test('avaliação duplicada, de outro usuário ou sem ticket válido é recusada', async () => {
  seed();
  const guild = makeGuild();
  const ticket = insertTicket({ status: 'closed', claimedBy: STAFF });
  const fields = { getTextInputValue: () => 'ok' };
  const good = interaction(`ticket_ratemodal_${ticket.id}_5`, guild, null, USER, [], { fields, message: { edit: async () => {} } });

  await routeTicketInteraction(good);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ticket_ratings WHERE ticket_id = ?').get(ticket.id).n, 1);

  const duplicate = interaction(`ticket_ratemodal_${ticket.id}_4`, guild, null, USER, [], { fields, message: { edit: async () => {} } });
  await routeTicketInteraction(duplicate);
  assert.match(duplicate.calls.at(-1)[1].embeds[0].data.description, /já possui/);

  const other = interaction(`ticket_rate_${ticket.id}_5`, guild, null, OTHER);
  await routeTicketInteraction(other);
  assert.match(other.calls[0][1].embeds[0].data.description, /Não encontrei/);

  const missing = interaction('ticket_rate_999999_5', guild, null, USER);
  await routeTicketInteraction(missing);
  assert.match(missing.calls[0][1].embeds[0].data.description, /Não encontrei/);
});
