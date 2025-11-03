import 'dotenv/config';
import {
  REST,
  Routes,
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
} from 'discord.js';

function readEnv(name) {
  const value = process.env[name];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      // Reflect the trimmed value back into process.env so any downstream
      // consumers (like discord.js) see the cleaned-up version.
      process.env[name] = trimmed;
      return trimmed;
    }
    return '';
  }
  return value ?? '';
}

// Ensure required environment variables exist before continuing
const DISCORD_TOKEN = readEnv('DISCORD_TOKEN');
const CLIENT_ID = readEnv('CLIENT_ID');
const GUILD_ID = readEnv('GUILD_ID');

const missingVars = [
  ['DISCORD_TOKEN', DISCORD_TOKEN],
  ['CLIENT_ID', CLIENT_ID],
  ['GUILD_ID', GUILD_ID],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  console.error(`   ${missingVars.join(', ')}`);
  console.error('Create a .env file with these variables set.');
  process.exitCode = 1;
  process.exit(1);
}

// Guard against obviously invalid snowflakes (Discord IDs are 17-20 digits)
const snowflakePattern = /^\d{17,20}$/;

if (!snowflakePattern.test(CLIENT_ID)) {
  console.error('❌ CLIENT_ID is not a valid Discord ID (must be 17-20 digits).');
  process.exit(1);
}

if (!snowflakePattern.test(GUILD_ID)) {
  console.error('❌ GUILD_ID is not a valid Discord ID (must be 17-20 digits).');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!'),
  new SlashCommandBuilder()
    .setName('echo')
    .setDescription('Echo back the provided text')
    .addStringOption((o) =>
      o
        .setName('text')
        .setDescription('What should I say?')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll a dice')
    .addIntegerOption((o) =>
      o
        .setName('sides')
        .setDescription('How many sides? (default 6)')
        .setMinValue(2)
        .setMaxValue(1000),
    ),
  new SlashCommandBuilder()
    .setName('ye')
    .setDescription('Render text in Olde English (Shakespearean style)')
    .addStringOption((o) =>
      o
        .setName('text')
        .setDescription('Text to translate')
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('style')
        .setDescription('Flavor')
        .addChoices(
          { name: 'plain', value: 'plain' },
          { name: 'bardic (adds “Prithee/Forsooth…”)', value: 'bardic' },
        ),
    ),
  new ContextMenuCommandBuilder()
    .setName('Ye Olde-ify')
    .setType(ApplicationCommandType.Message),
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function registerCommands() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run') || args.has('--noop') || args.has('-n');
  const debugFlag =
    args.has('--debug') || ['1', 'true', 'yes'].includes(process.env.DEBUG?.toLowerCase?.() ?? '');

  try {
    console.log('📝 Starting command registration…');
    console.log(`   • Application ID: ${CLIENT_ID}`);
    console.log(`   • Guild ID: ${GUILD_ID}`);

    if (dryRun) {
      console.log('ℹ️ Dry run enabled — no request sent to Discord.');
      console.log('   Commands that would be registered:');
      for (const command of commands) {
        console.log(`   • ${command.name}`);
      }
      return;
    }

    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });

    console.log('✅ Commands registered successfully!');
    console.log('   Commands should be available immediately in the guild.');
  } catch (error) {
    if (error?.code === 50001 || error?.rawError?.code === 50001) {
      console.error('❌ Missing Access (code 50001). Common causes:');
      console.error('   1. The bot is not a member of the guild specified by GUILD_ID.');
      console.error("   2. CLIENT_ID doesn't match the application for the provided bot token.");
      console.error('   3. GUILD_ID points to a server where the bot lacks access.');
      console.error('   4. The bot was invited without the "applications.commands" scope.');
      if (process.env.DISCORD_BOT_INVITE) {
        console.error('   Re-invite the bot using:');
        console.error(`     ${process.env.DISCORD_BOT_INVITE}`);
      }
    } else if (error?.status === 401) {
      console.error('❌ Unauthorized (401). Double-check DISCORD_TOKEN — it may be invalid or revoked.');
    } else if (error?.status === 403) {
      console.error('❌ Forbidden (403). Ensure the bot has the "applications.commands" scope in the target guild.');
    } else if (
      error instanceof AggregateError &&
      error.errors?.every((err) => err?.code === 'ENETUNREACH' || err?.code === 'ENOTFOUND')
    ) {
      console.error('❌ Network error: unable to reach Discord.');
      console.error('   Check your internet connection, firewall, or proxy settings and try again.');
    } else if (error?.code === 'ENOTFOUND' || error?.code === 'ENETUNREACH') {
      console.error('❌ Network error: unable to reach Discord.');
      console.error('   Check your internet connection, firewall, or proxy settings and try again.');
    } else {
      console.error('❌ Failed to register commands:', error);
    }
    if (debugFlag) {
      console.error('🛠️ Debug details:', error);
    }
    process.exitCode = 1;
  }
}

registerCommands().catch((error) => {
  console.error('❌ Unexpected failure while registering commands:', error);
  process.exit(1);
});
