const { Events } = require('discord.js');
const { logEvent } = require('../utils/logger');
const { colors } = require('../config/settings');

module.exports = {
  name: Events.GuildBanRemove,
  async execute(ban) {
    await logEvent(
      ban.guild,
      '🕊️ Membro desbanido',
      `${ban.user.tag} (${ban.user.id}) foi desbanido.`,
      colors.success
    );
  },
};
