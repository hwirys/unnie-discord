# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Discord bot for Chzzk (치지직) live stream notifications and YouTube new video notifications. Built with discord.js v14, Node.js 20+.

## Commands

```bash
npm install          # Install dependencies
node index.js        # Run the bot (requires BOT_TOKEN in .env)
```

No build step, no tests, no linter configured.

## Architecture

```
index.js     → Main entry. Discord client, all 17 slash command definitions & handlers, reaction role events, global error handlers
config.js    → JSON file-based config manager with dot-notation access (config.get("chzzk.channel_id"), config.set(...))
chzzk.js     → Chzzk live monitoring. Polls API every 30s, detects CLOSE→OPEN/OPEN→CLOSE transitions
youtube.js   → YouTube monitoring. Polls RSS feed every 3min, detects new video IDs
```

All modules share config through `require("./config")`. Monitors are started via `chzzk.start(client)` / `youtube.start(client)` from the ready event.

## Key Patterns

**Config safety**: config.js blocks prototype pollution (`__proto__`, `constructor`, `prototype`), enforces a top-level key whitelist (`ALLOWED_TOP_KEYS`), and uses atomic writes (tmp + rename). When adding new top-level config keys, you must add them to both `ALLOWED_TOP_KEYS` and `DEFAULT_CONFIG`.

**Channel fetch**: Always use `client.channels.cache.get(id) || await client.channels.fetch(id).catch(() => null)` — cache alone misses channels the bot hasn't interacted with yet.

**Input validation**: Chzzk IDs must match `/^[a-f0-9]{32}$/`, YouTube channel IDs `/^UC[A-Za-z0-9_-]{22}$/`. User-supplied text is sanitized via `sanitizeText()` which truncates length and masks `@everyone`/`@here`.

**Monitoring state**: Duplicate notifications are prevented by persisting `chzzk.last_status` (OPEN/CLOSE) and `youtube.last_video_id` in config.json. On first YouTube setup, the current video ID is recorded silently without sending a notification.

**Slash commands**: Admin commands use `setDefaultMemberPermissions(0x8)` (ADMINISTRATOR). Rate limited at 5s cooldown per user per command. All command handling is in the `handleCommand()` function inside index.js.

**Mention system**: Chzzk uses `mention_role_id`, YouTube uses `youtube_mention_role_id`. Value is either a role ID string, `"everyone"`, or `null`.

## Adding a New Slash Command

1. Add `SlashCommandBuilder` to the `commands` array in index.js
2. Add handler in `handleCommand()` function (else-if chain)
3. If it needs config storage, add the key to both `ALLOWED_TOP_KEYS` and `DEFAULT_CONFIG` in config.js
4. Bot restart re-registers commands globally (may take up to 1 hour to propagate to all servers)

## Commit Convention

Do not include `Co-Authored-By` lines in commits.
