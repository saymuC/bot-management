const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed, errorEmbed } = require('../../utils/embeds');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');
const { emoji } = require('../../utils/emojis');
const { resolveEmojiSource, fetchEmojiImage, sanitizeEmojiName } = require('../../utils/emojiSource');

/** Vagas de emoji por nível de impulso — estáticos e animados contam separado. */
const SLOTS_BY_TIER = Object.freeze({ 0: 50, 1: 100, 2: 150, 3: 250 });

function slotsFor(guild, animated) {
  const total = SLOTS_BY_TIER[guild.premiumTier] ?? SLOTS_BY_TIER[0];
  const used = guild.emojis.cache.filter((item) => item.animated === animated).size;
  return { total, used, free: total - used };
}

/** Traduz os erros da API que o usuário pode resolver. */
function describeApiError(err) {
  if (err.code === 30008) return 'Este servidor já está com todas as vagas de emoji ocupadas.';
  if (err.code === 50035) return 'O Discord recusou a imagem. Ela pode estar corrompida ou fora do formato aceito.';
  if (err.code === 50013) return 'Me falta permissão para criar emojis aqui.';
  if (err.code === 30018) return 'Este servidor já está com todas as vagas de emoji animado ocupadas.';
  return null;
}

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder()
    .setName('emoji-add')
    .setDescription('Adiciona a este servidor um emoji de outro servidor, de um ID ou de uma imagem')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt
        .setName('emoji')
        .setDescription('Cole o emoji de outro servidor, o ID dele ou um link https da imagem')
        .setMaxLength(300)
    )
    .addAttachmentOption((opt) =>
      opt.setName('arquivo').setDescription('Ou envie a imagem do emoji (png, jpg, gif, webp — até 256 KB)')
    )
    .addStringOption((opt) =>
      opt.setName('nome').setDescription('Nome do emoji (2 a 32 caracteres, sem espaços)').setMaxLength(32)
    ),

  async execute(interaction) {
    const input = interaction.options.getString('emoji');
    const attachment = interaction.options.getAttachment('arquivo');
    const desiredName = interaction.options.getString('nome');

    if (input && attachment) {
      return respond(interaction, {
        embeds: [errorEmbed('Escolha só uma origem: ou a opção `emoji`, ou a opção `arquivo`.')],
      });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
      return respond(interaction, {
        embeds: [errorEmbed('Preciso da permissão **Gerenciar Expressões** para criar emojis neste servidor.')],
      });
    }

    const source = await resolveEmojiSource({ input, attachment });
    if (!source.ok) return respond(interaction, { embeds: [errorEmbed(source.error)] });

    const image = await fetchEmojiImage(source.url);
    if (!image.ok) return respond(interaction, { embeds: [errorEmbed(image.error)] });

    // O GIF é o único formato animado que o Discord aceita como emoji.
    const animated = image.bytes.subarray(0, 3).toString('latin1') === 'GIF';
    const slots = slotsFor(interaction.guild, animated);
    if (slots.free <= 0) {
      return respond(interaction, {
        embeds: [
          errorEmbed(
            `Não há vaga de emoji ${animated ? 'animado' : 'estático'}: ${slots.used}/${slots.total} em uso. ` +
              'Apague um emoji ou impulsione o servidor.'
          ),
        ],
      });
    }

    let created;
    try {
      created = await interaction.guild.emojis.create({
        attachment: image.bytes,
        name: desiredName ? sanitizeEmojiName(desiredName) : source.name,
        reason: `/emoji-add por ${interaction.user.tag} (${interaction.user.id})`,
      });
    } catch (err) {
      const friendly = describeApiError(err);
      if (!friendly) throw err;
      return respond(interaction, { embeds: [errorEmbed(friendly)] });
    }

    // O cache só reflete o emoji novo quando o evento da gateway chegar, então
    // a contagem é feita à mão para o rodapé não sair defasado.
    const usedAfter = slots.used + 1;
    await logEvent(
      interaction.guild,
      `${emoji(interaction.guild, 'success')} Emoji adicionado`,
      `**Emoji:** ${created} \`:${created.name}:\`\n**Por:** ${interaction.user.tag} (${interaction.user.id})`,
      colors.success
    );

    return respond(interaction, {
      embeds: [
        baseEmbed({
          title: `${emoji(interaction.guild, 'success')} Emoji adicionado`,
          description: `${created} já pode ser usado como \`:${created.name}:\``,
          color: colors.success,
          thumbnail: created.imageURL({ size: 128 }),
          footer: `Vagas de emoji ${animated ? 'animado' : 'estático'}: ${usedAfter}/${slots.total}`,
        }),
      ],
    });
  },
};
