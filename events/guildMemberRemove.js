const { Events } = require('discord.js');
const { logEvent } = require('../utils/logger');
const { colors } = require('../config/settings');
const { emoji } = require('../utils/emojis');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    await logEvent(
      member.guild,
      `${emoji(member.guild, 'member_leave')} Membro saiu`,
      `${member.user?.tag ?? member.id} (${member.id}) saiu do servidor.`,
      colors.warning
    );
  },
};
