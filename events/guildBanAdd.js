const { Events } = require('discord.js');
const { logEvent } = require('../utils/logger');
const { colors } = require('../config/settings');
const { emoji } = require('../utils/emojis');

module.exports = {
  name: Events.GuildBanAdd,
  async execute(ban) {
    await logEvent(
      ban.guild,
      `${emoji(ban.guild, 'ban')} Membro banido`,
      `${ban.user.tag} (${ban.user.id}) foi banido.\n**Motivo:** ${ban.reason ?? 'não informado'}`,
      colors.error
    );
  },
};
