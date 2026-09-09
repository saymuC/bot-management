/**
 * Fluxo de verificação por captcha.
 *
 * Antes o botão do painel dava o cargo direto, então qualquer conta que
 * clicasse entrava — um bot de auto-join resolvia isso num request. Agora o
 * clique só abre um desafio: o bot manda uma imagem com um código distorcido
 * (efêmera, só a pessoa vê) e o cargo sai apenas depois de a pessoa digitar o
 * código certo num modal, dentro do prazo e do limite de tentativas.
 *
 * customIds:
 *   verify_button        botão fixo do painel público (entra no desafio)
 *   verify_code          abre o modal para digitar o código
 *   verify_new           descarta a imagem atual e gera outra
 *   verify_modal         submit do modal com a resposta
 */

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { getGuildConfig } = require('../database/db');
const { resolveColor } = require('../utils/colors');
const { logEvent } = require('../utils/logger');
const { formatDuration } = require('../utils/time');
const { colors, verify: verifyConfig } = require('../config/settings');
const { isOAuthEnabled, createOAuthUrl } = require('../oauth/server');
const { generateCode, renderCaptcha, matchesCode } = require('../utils/captcha');
const { makeSafeAck, swallowAckFailure } = require('../utils/interactionAck');
const { putChallenge, getChallenge, deleteChallenge, registerFailure, cooldownRemaining } = require('../utils/verifyChallenges');
const {
  BUTTON_STYLES,
  getVerifyPanelConfig,
  resolveButtonEmoji,
  resolvePanelTitle,
} = require('../utils/verifyPanelConfig');

const PREFIX = 'verify_';
const IMAGE_NAME = 'captcha.png';

/** Acka tolerando token morto (3s) ou clique já respondido; false = fluxo para. */
const safeAck = makeSafeAck('verify');

/** Primeira resposta ao clique do painel, sempre visível só para quem clicou. */
const replyEphemeral = (interaction, payload) =>
  safeAck(interaction, () => interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }));

/** Botões abaixo da imagem do captcha. */
const challengeComponents = () => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}code`).setLabel('Inserir código').setEmoji('⌨️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}new`).setLabel('Gerar outra imagem').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
  ),
];

/**
 * Payload efêmero do desafio.
 *
 * A imagem vai como anexo referenciado por `attachment://`: o código não pode
 * aparecer em texto, senão bastaria ler a mensagem para responder.
 */
function challengePayload(challenge, notice = '') {
  const description = [
    `Digite o código da imagem para liberar seu acesso. São **${verifyConfig.codeLength} caracteres**, e não diferenciamos maiúsculas de minúsculas.`,
    `⏳ Este desafio expira <t:${Math.floor(challenge.expiresAt / 1000)}:R>.`,
    `🎯 Tentativas restantes: **${verifyConfig.maxAttempts - challenge.attempts}** de ${verifyConfig.maxAttempts}.`,
  ];
  if (notice) description.push('', notice);

  return {
    content: '',
    embeds: [
      baseEmbed({
        title: '🔐 Verificação',
        description: description.join('\n'),
        color: colors.primary,
        image: `attachment://${IMAGE_NAME}`,
      }),
    ],
    components: challengeComponents(),
    files: [new AttachmentBuilder(challenge.image, { name: IMAGE_NAME })],
  };
}

/** Fecha o desafio: mensagem final sem botões e sem a imagem. */
const closeChallenge = (interaction, embed) =>
  interaction.editReply({ content: '', embeds: [embed], components: [], files: [] });

/**
 * Gera uma imagem nova preservando o contador de tentativas.
 * @returns {object|null} o desafio, ou null se o host não consegue renderizar.
 */
function issueChallenge(guildId, userId) {
  const code = generateCode();
  const image = renderCaptcha(code);
  if (!image) return null;
  return putChallenge(guildId, userId, code, image);
}

/**
 * Valida se a verificação pode acontecer neste servidor e para esta pessoa.
 * @returns {{ ok: true, roleId: string }|{ ok: false, embed: import('discord.js').EmbedBuilder }}
 */
function checkEligibility(interaction) {
  const config = getGuildConfig(interaction.guild.id);
  if (!config?.verify_role_id) {
    return { ok: false, embed: errorEmbed('Verificação não configurada neste servidor. Avise a staff.') };
  }
  if (interaction.member.roles.cache.has(config.verify_role_id)) {
    return { ok: false, embed: successEmbed('Você já está verificado. Nada a fazer aqui. 🎉') };
  }

  const cooldown = cooldownRemaining(interaction.guild.id, interaction.user.id);
  if (cooldown > 0) {
    return {
      ok: false,
      embed: errorEmbed(
        `Você errou o código ${verifyConfig.maxAttempts} vezes. Tente novamente em **${formatDuration(cooldown)}**.`,
        '⏳ Aguarde'
      ),
    };
  }
  return { ok: true, roleId: config.verify_role_id };
}

// Funções e não constantes: baseEmbed grava o timestamp na criação, e um embed
// reaproveitado mostraria a hora em que o bot subiu.
const renderFailureEmbed = () =>
  errorEmbed('Não consegui gerar a imagem do captcha neste momento. Avise a staff para checar os logs do bot.');

const expiredEmbed = () =>
  errorEmbed('Este desafio expirou. Clique no botão do painel de verificação para receber uma imagem nova.');

/**
 * Clique no painel público: abre o desafio numa resposta efêmera.
 *
 * Responde direto, sem deferReply antes. O defer só compensa quando há trabalho
 * lento antes da resposta, e aqui não há: gerar e desenhar o captcha custa ~8ms
 * (medido), enquanto o defer custa uma ida-e-volta REST inteira. Cortá-lo deixa
 * só um ack dentro da janela de 3s em vez de dois, reduzindo a chance do 10062
 * justamente no caminho onde ele aparecia.
 */
async function handleStart(interaction) {
  const eligibility = checkEligibility(interaction);
  if (!eligibility.ok) return replyEphemeral(interaction, { embeds: [eligibility.embed] });

  const challenge = issueChallenge(interaction.guild.id, interaction.user.id);
  if (!challenge) {
    console.error('[verify] Captcha não renderizado: nenhuma fonte disponível no host.');
    return replyEphemeral(interaction, { embeds: [renderFailureEmbed()] });
  }
  return replyEphemeral(interaction, challengePayload(challenge));
}

/** "Gerar outra imagem": novo código, mesmo contador de tentativas. */
async function handleNew(interaction) {
  if (!(await safeAck(interaction, () => interaction.deferUpdate()))) return undefined;

  const eligibility = checkEligibility(interaction);
  if (!eligibility.ok) return closeChallenge(interaction, eligibility.embed);

  const challenge = issueChallenge(interaction.guild.id, interaction.user.id);
  if (!challenge) {
    console.error('[verify] Captcha não renderizado: nenhuma fonte disponível no host.');
    return closeChallenge(interaction, renderFailureEmbed());
  }
  return interaction.editReply(challengePayload(challenge, '🔄 Imagem nova gerada.'));
}

/** Abre o modal da resposta. Não admite defer antes do showModal. */
function handleOpenModal(interaction) {
  const challenge = getChallenge(interaction.guild.id, interaction.user.id);
  if (!challenge) return replyExpired(interaction);

  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}modal`)
    .setTitle('Verificação')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('codigo')
          .setLabel(`Código da imagem (${verifyConfig.codeLength} caracteres)`)
          .setPlaceholder('Digite exatamente o que aparece na imagem')
          .setStyle(TextInputStyle.Short)
          // Folga no limite para não travar quem digita espaço entre os caracteres.
          .setMinLength(verifyConfig.codeLength)
          .setMaxLength(verifyConfig.codeLength * 2)
          .setRequired(true)
      )
    );

  return interaction.showModal(modal).catch(swallowAckFailure('verify', interaction));
}

/** Concede o cargo e encerra o desafio. */
async function grantAccess(interaction, roleId, attemptsUsed) {
  try {
    await interaction.member.roles.add(roleId, 'Verificação por captcha');
  } catch (err) {
    console.error('[verify] Falha ao adicionar cargo:', err.message);
    return closeChallenge(
      interaction,
      errorEmbed('Você acertou o código, mas não consegui te dar o cargo. Avise a staff (o cargo do bot precisa estar acima do cargo de verificado).')
    );
  }

  deleteChallenge(interaction.guild.id, interaction.user.id);

  await logEvent(
    interaction.guild,
    '🔐 Verificação concluída',
    `${interaction.user} (\`${interaction.user.tag}\`) passou no captcha.`,
    colors.success,
    [
      { name: 'Tentativas usadas', value: `${attemptsUsed} de ${verifyConfig.maxAttempts}`, inline: true },
      { name: 'Cargo', value: `<@&${roleId}>`, inline: true },
    ]
  );

  // Com OAuth configurado, ainda oferecemos a conexão da conta: é o que permite
  // a staff readicionar a pessoa depois (/pull-user). Opcional, o acesso já saiu.
  if (isOAuthEnabled()) {
    return interaction.editReply({
      content: '',
      embeds: [
        successEmbed(
          'Código correto! Você foi verificado. Bem-vindo(a) ao servidor. 🎉\n\n' +
            'Opcional: conecte sua conta no botão abaixo para poder ser readicionado automaticamente pela staff.'
        ),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Conectar conta').setStyle(ButtonStyle.Link).setURL(createOAuthUrl(interaction.guild.id))
        ),
      ],
      files: [],
    });
  }

  return closeChallenge(interaction, successEmbed('Código correto! Você foi verificado. Bem-vindo(a) ao servidor. 🎉'));
}

/** Resposta do modal: acerta e libera, erra e consome tentativa. */
async function handleAnswer(interaction) {
  const eligibility = checkEligibility(interaction);
  if (!eligibility.ok) {
    if (!(await safeAck(interaction, () => interaction.deferUpdate()))) return undefined;
    return closeChallenge(interaction, eligibility.embed);
  }

  const challenge = getChallenge(interaction.guild.id, interaction.user.id);
  if (!challenge) return replyExpired(interaction);

  const answer = interaction.fields.getTextInputValue('codigo');

  if (matchesCode(answer, challenge.code)) {
    if (!(await safeAck(interaction, () => interaction.deferUpdate()))) return undefined;
    return grantAccess(interaction, eligibility.roleId, challenge.attempts + 1);
  }

  const { remaining, blocked } = registerFailure(interaction.guild.id, interaction.user.id);
  if (!(await safeAck(interaction, () => interaction.deferUpdate()))) return undefined;

  if (blocked) {
    await logEvent(
      interaction.guild,
      '⛔ Verificação bloqueada',
      `${interaction.user} (\`${interaction.user.tag}\`) errou o captcha ${verifyConfig.maxAttempts} vezes e entrou em cooldown.`,
      colors.error,
      [{ name: 'Cooldown', value: formatDuration(verifyConfig.cooldownMs), inline: true }]
    );
    return closeChallenge(
      interaction,
      errorEmbed(
        `Código errado ${verifyConfig.maxAttempts} vezes. Aguarde **${formatDuration(verifyConfig.cooldownMs)}** e clique no painel novamente.`,
        '⛔ Tentativas esgotadas'
      )
    );
  }

  const updated = getChallenge(interaction.guild.id, interaction.user.id);
  if (!updated) return closeChallenge(interaction, expiredEmbed());
  return interaction.editReply(
    challengePayload(updated, `❌ Código incorreto. Você ainda tem **${remaining}** tentativa(s). Se a imagem estiver ilegível, gere outra.`)
  );
}

/** Desafio inexistente/expirado: modal responde do zero, botão edita a mensagem. */
function replyExpired(interaction) {
  if (interaction.isModalSubmit() && !interaction.isFromMessage()) {
    return safeAck(interaction, () => interaction.reply({ embeds: [expiredEmbed()], flags: MessageFlags.Ephemeral }));
  }
  return safeAck(interaction, () =>
    interaction.update({ content: '', embeds: [expiredEmbed()], components: [], files: [] })
  );
}

/**
 * Roteia as interações da verificação (`verify_*`).
 * Gerencia o próprio ack: `showModal` não admite defer antes.
 */
async function routeVerifyInteraction(interaction) {
  switch (interaction.customId) {
    case `${PREFIX}button`:
      // Único caminho que ainda não tem resposta aberta: vem do painel público.
      // Ele mesmo responde (sem defer) — ver o comentário em handleStart.
      return handleStart(interaction);
    case `${PREFIX}code`:
      return handleOpenModal(interaction);
    case `${PREFIX}new`:
      return handleNew(interaction);
    case `${PREFIX}modal`:
      return handleAnswer(interaction);
    default:
      return undefined;
  }
}

/**
 * Painel público de verificação (usado pelo /setup-verify).
 *
 * Aparência inteira vem da config do servidor, então o mesmo builder serve para
 * o preview do painel de configuração e para a mensagem publicada de verdade.
 *
 * @param {import('discord.js').Guild} guild
 * @param {ReturnType<typeof getVerifyPanelConfig>} [config]
 */
function buildVerifyPanel(guild, config = getVerifyPanelConfig(guild.id)) {
  const button = new ButtonBuilder()
    .setCustomId(`${PREFIX}button`)
    .setLabel(config.button.label)
    .setStyle(BUTTON_STYLES[config.button.style].style);

  const buttonEmoji = resolveButtonEmoji(guild, config);
  if (buttonEmoji) button.setEmoji(buttonEmoji);

  return {
    embeds: [
      baseEmbed({
        title: resolvePanelTitle(guild, config),
        description: config.embed.description,
        color: resolveColor(config.embed.color) ?? undefined,
        footer: config.embed.footer ?? undefined,
        image: config.embed.imageUrl ?? undefined,
        thumbnail: config.embed.thumbnailUrl ?? undefined,
      }),
    ],
    components: [new ActionRowBuilder().addComponents(button)],
  };
}

module.exports = { PREFIX, routeVerifyInteraction, buildVerifyPanel };
