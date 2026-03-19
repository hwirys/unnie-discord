require("dotenv").config();

const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, REST, Routes, Collection, Partials } = require("discord.js");
const config = require("./config");
const chzzk = require("./chzzk");
const youtube = require("./youtube");

// ── Validation helpers ──
const CHZZK_ID_RE = /^[a-f0-9]{32}$/;
const YT_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const HEX_COLOR_RE = /^[0-9A-Fa-f]{6}$/;
const MAX_MESSAGE_LENGTH = 500;
const MAX_EMBED_DESC_LENGTH = 1000;

function parseColor(hex, fallback) {
  if (!hex) return fallback;
  const n = parseInt(String(hex).replace("#", ""), 16);
  return isNaN(n) || n > 0xffffff ? fallback : n;
}

function sanitizeText(text, maxLen) {
  if (typeof text !== "string") return "";
  return text.slice(0, maxLen).replace(/@(everyone|here)/gi, "@\u200b$1");
}

// ── Rate limiter ──
const cooldowns = new Collection();
const COOLDOWN_MS = 5000;

function checkCooldown(userId, commandName) {
  const key = `${userId}-${commandName}`;
  const now = Date.now();
  const expiry = cooldowns.get(key);
  if (expiry && now < expiry) {
    return Math.ceil((expiry - now) / 1000);
  }
  cooldowns.set(key, now + COOLDOWN_MS);
  return 0;
}

// ── Token ──
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) throw new Error("BOT_TOKEN이 .env 파일에 설정되어 있지 않습니다.");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

// ── Slash commands ──
const commands = [
  new SlashCommandBuilder()
    .setName("알림채널")
    .setDescription("현재 채널을 알림 채널로 설정합니다")
    .setDefaultMemberPermissions(0x8),

  new SlashCommandBuilder()
    .setName("치지직")
    .setDescription("모니터링할 치지직 채널을 설정합니다")
    .addStringOption((o) => o.setName("채널").setDescription("치지직 채널 ID 또는 URL").setRequired(true))
    .setDefaultMemberPermissions(0x8),

  new SlashCommandBuilder()
    .setName("유튜브")
    .setDescription("모니터링할 YouTube 채널을 설정합니다")
    .addStringOption((o) => o.setName("채널").setDescription("YouTube 채널 ID 또는 URL").setRequired(true))
    .setDefaultMemberPermissions(0x8),

  new SlashCommandBuilder()
    .setName("핑설정")
    .setDescription("알림 시 멘션할 역할을 설정합니다")
    .addStringOption((o) =>
      o.setName("플랫폼").setDescription("핑을 설정할 플랫폼").setRequired(true)
        .addChoices(
          { name: "치지직", value: "chzzk" },
          { name: "YouTube", value: "youtube" },
        ))
    .addStringOption((o) =>
      o.setName("대상").setDescription("멘션할 역할").setRequired(true)
        .addChoices(
          { name: "@everyone", value: "everyone" },
          { name: "역할 직접 지정", value: "role" },
          { name: "핑 없음", value: "none" },
        ))
    .addRoleOption((o) => o.setName("역할").setDescription("멘션할 역할 (역할 직접 지정 선택 시)").setRequired(false))
    .setDefaultMemberPermissions(0x8),

  new SlashCommandBuilder()
    .setName("문구설정")
    .setDescription("알림 메시지 문구를 수정합니다")
    .addStringOption((o) =>
      o.setName("종류").setDescription("수정할 알림 종류").setRequired(true)
        .addChoices(
          { name: "치지직 방송 시작 문구", value: "chzzk_start" },
          { name: "치지직 방송 종료 문구", value: "chzzk_end" },
          { name: "YouTube 새 영상 문구", value: "youtube_new" },
          { name: "치지직 방송 시작 제목", value: "chzzk_start_title" },
          { name: "치지직 방송 종료 제목", value: "chzzk_end_title" },
          { name: "YouTube 새 영상 제목", value: "youtube_title" },
        ))
    .addStringOption((o) => o.setName("문구").setDescription("새로운 알림 문구").setRequired(true))
    .setDefaultMemberPermissions(0x8),

  new SlashCommandBuilder()
    .setName("임베드설정")
    .setDescription("알림 임베드의 색상과 설명을 수정합니다")
    .addStringOption((o) =>
      o.setName("종류").setDescription("수정할 알림 종류").setRequired(true)
        .addChoices(
          { name: "치지직 방송 시작", value: "chzzk_start" },
          { name: "치지직 방송 종료", value: "chzzk_end" },
          { name: "YouTube 새 영상", value: "youtube" },
        ))
    .addStringOption((o) => o.setName("색상").setDescription("임베드 색상 (예: #FF0000, #00FFA3)").setRequired(false))
    .addStringOption((o) => o.setName("설명").setDescription("임베드 안에 표시할 추가 문구 (비우려면 '없음' 입력)").setRequired(false))
    .setDefaultMemberPermissions(0x8),

  new SlashCommandBuilder()
    .setName("반응역할")
    .setDescription("이모지 클릭 시 역할을 부여하는 메시지를 설정합니다")
    .addStringOption((o) => o.setName("이모지").setDescription("이모지 (예: 🎮)").setRequired(true))
    .addRoleOption((o) => o.setName("역할").setDescription("부여할 역할").setRequired(true))
    .setDefaultMemberPermissions(0x8),

  new SlashCommandBuilder()
    .setName("반응역할제거")
    .setDescription("반응 역할에서 이모지-역할 매핑을 제거합니다")
    .addStringOption((o) => o.setName("이모지").setDescription("제거할 이모지").setRequired(true))
    .setDefaultMemberPermissions(0x8),

  new SlashCommandBuilder()
    .setName("반응역할초기화")
    .setDescription("반응 역할 메시지를 삭제하고 초기화합니다")
    .setDefaultMemberPermissions(0x8),

  new SlashCommandBuilder()
    .setName("상태")
    .setDescription("현재 봇 설정 상태를 표시합니다"),

  new SlashCommandBuilder()
    .setName("테스트")
    .setDescription("치지직/YouTube 알림을 테스트합니다")
    .setDefaultMemberPermissions(0x8),

  new SlashCommandBuilder()
    .setName("굿즈")
    .setDescription("굿즈 정보를 확인합니다"),

  new SlashCommandBuilder()
    .setName("굿즈설정")
    .setDescription("굿즈 URL과 문구를 설정합니다")
    .addStringOption((o) => o.setName("url").setDescription("굿즈 URL").setRequired(false))
    .addStringOption((o) => o.setName("제목").setDescription("임베드 제목").setRequired(false))
    .addStringOption((o) => o.setName("문구").setDescription("홍보 문구").setRequired(false))
    .setDefaultMemberPermissions(0x8),

  new SlashCommandBuilder()
    .setName("클립")
    .setDescription("언니의 명장면 클립을 랜덤으로 보여줍니다"),

  new SlashCommandBuilder()
    .setName("클립추가")
    .setDescription("클립을 추가합니다")
    .addStringOption((o) => o.setName("제목").setDescription("클립 제목").setRequired(true))
    .addStringOption((o) => o.setName("url").setDescription("클립 URL").setRequired(true))
    .setDefaultMemberPermissions(0x8),

  new SlashCommandBuilder()
    .setName("클립목록")
    .setDescription("등록된 클립 목록을 확인합니다"),

  new SlashCommandBuilder()
    .setName("클립삭제")
    .setDescription("클립을 삭제합니다")
    .addIntegerOption((o) => o.setName("번호").setDescription("삭제할 클립 번호").setRequired(true))
    .setDefaultMemberPermissions(0x8),
];

// ── Command handler ──
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // Rate limit check (except /상태)
  if (commandName !== "상태") {
    const remaining = checkCooldown(interaction.user.id, commandName);
    if (remaining > 0) {
      return interaction.reply({ content: `⏳ ${remaining}초 후에 다시 시도해주세요.`, ephemeral: true });
    }
  }

  try {
    await handleCommand(interaction, commandName);
  } catch (e) {
    console.error(`[명령어 오류] ${commandName}:`, e.message);
    const reply = { content: "❌ 명령어 처리 중 오류가 발생했습니다.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

async function handleCommand(interaction, commandName) {
  // /알림채널
  if (commandName === "알림채널") {
    config.set("notification_channel_id", interaction.channelId);
    await interaction.reply(`✅ 알림 채널이 <#${interaction.channelId}>(으)로 설정되었습니다.`);
  }

  // /치지직
  else if (commandName === "치지직") {
    await interaction.deferReply();
    let channelId = interaction.options.getString("채널");

    const match = channelId.match(/chzzk\.naver\.com\/(?:live\/)?([a-f0-9]+)/);
    if (match) channelId = match[1];

    if (!CHZZK_ID_RE.test(channelId)) {
      return interaction.editReply("❌ 올바른 치지직 채널 ID가 아닙니다. (32자리 영숫자)");
    }

    const res = await fetch(`https://api.chzzk.naver.com/service/v3/channels/${channelId}/live-detail`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return interaction.editReply("❌ 치지직 채널을 찾을 수 없습니다.");
    const json = await res.json();
    if (!json.content) return interaction.editReply("❌ 치지직 채널을 찾을 수 없습니다.");

    const name = json.content.channel?.channelName || "알 수 없음";
    config.set("chzzk.channel_id", channelId);
    config.set("chzzk.last_status", "CLOSE");
    config.set("chzzk.channel_name", name);

    await interaction.editReply(`✅ 치지직 채널이 \`${channelId}\` (${name})(으)로 설정되었습니다.`);
  }

  // /유튜브
  else if (commandName === "유튜브") {
    await interaction.deferReply();
    let channelId = interaction.options.getString("채널");

    const match = channelId.match(/youtube\.com\/channel\/([A-Za-z0-9_-]+)/);
    if (match) channelId = match[1];

    if (!YT_CHANNEL_ID_RE.test(channelId)) {
      return interaction.editReply("❌ 올바른 YouTube 채널 ID가 아닙니다. (UC로 시작하는 24자리)");
    }

    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return interaction.editReply("❌ YouTube 채널을 찾을 수 없습니다.");

    config.set("youtube.channel_id", channelId);
    config.set("youtube.last_video_id", null);
    config.set("youtube.channel_name", null);

    await interaction.editReply(`✅ YouTube 채널이 \`${channelId}\`(으)로 설정되었습니다.`);
  }

  // /핑설정
  else if (commandName === "핑설정") {
    const platform = interaction.options.getString("플랫폼");
    const target = interaction.options.getString("대상");
    const configKey = platform === "youtube" ? "youtube_mention_role_id" : "mention_role_id";
    const label = platform === "youtube" ? "YouTube" : "치지직";

    if (target === "everyone") {
      config.set(configKey, "everyone");
      await interaction.reply(`✅ **${label}** 알림 시 \`@everyone\`을 멘션합니다.`);
    } else if (target === "role") {
      const role = interaction.options.getRole("역할");
      if (!role) return interaction.reply({ content: "❌ 역할을 선택해주세요.", ephemeral: true });
      config.set(configKey, role.id);
      await interaction.reply(`✅ **${label}** 알림 시 <@&${role.id}> 역할을 멘션합니다.`);
    } else {
      config.set(configKey, null);
      await interaction.reply(`✅ **${label}** 알림 시 멘션을 하지 않습니다.`);
    }
  }

  // /임베드설정
  else if (commandName === "임베드설정") {
    const type = interaction.options.getString("종류");
    const color = interaction.options.getString("색상");
    const desc = interaction.options.getString("설명");
    const labels = { chzzk_start: "치지직 방송 시작", chzzk_end: "치지직 방송 종료", youtube: "YouTube 새 영상" };
    const changes = [];

    if (color) {
      const hex = color.replace("#", "");
      if (!HEX_COLOR_RE.test(hex)) {
        return interaction.reply({ content: "❌ 색상은 `#FF0000` 같은 6자리 HEX 코드로 입력해주세요.", ephemeral: true });
      }
      config.set(`embeds.${type}_color`, `#${hex}`);
      changes.push(`색상 → \`#${hex}\` 🎨`);
    }

    if (desc !== null && desc !== undefined) {
      const safe = desc === "없음" ? "" : sanitizeText(desc, MAX_EMBED_DESC_LENGTH);
      config.set(`embeds.${type}_desc`, safe);
      changes.push(desc === "없음" ? "설명 → 삭제됨" : `설명 → ${safe}`);
    }

    if (changes.length === 0) {
      return interaction.reply({ content: "❌ 색상 또는 설명 중 하나는 입력해주세요.", ephemeral: true });
    }

    await interaction.reply(`✅ **${labels[type]}** 임베드가 변경되었습니다.\n${changes.join("\n")}`);
  }

  // /반응역할
  else if (commandName === "반응역할") {
    await interaction.deferReply({ ephemeral: true });
    const emoji = interaction.options.getString("이모지").trim();
    const role = interaction.options.getRole("역할");

    // Validate emoji (unicode or custom <:name:id>)
    const isUnicode = /\p{Emoji_Presentation}/u.test(emoji);
    const customMatch = emoji.match(/^<a?:\w+:(\d+)>$/);
    if (!isUnicode && !customMatch) {
      return interaction.editReply("❌ 올바른 이모지를 입력해주세요.");
    }

    const mappings = config.get("reaction_roles.mappings") || {};
    mappings[emoji] = role.id;

    let msgId = config.get("reaction_roles.message_id");
    let chId = config.get("reaction_roles.channel_id");

    // Build embed
    const lines = Object.entries(mappings).map(([e, rId]) => `${e} → <@&${rId}>`);
    const embed = new EmbedBuilder()
      .setTitle("🎭 역할 선택")
      .setDescription("아래 이모지를 클릭해서 역할을 받으세요!\n다시 클릭하면 역할이 제거됩니다.\n\n" + lines.join("\n"))
      .setColor(0x5865f2);

    try {
      if (msgId && chId) {
        // Update existing message
        const channel = client.channels.cache.get(chId);
        if (channel) {
          try {
            const msg = await channel.messages.fetch(msgId);
            await msg.edit({ embeds: [embed] });
            await msg.react(emoji);
          } catch {
            // Message deleted, create new one
            msgId = null;
          }
        }
      }

      if (!msgId) {
        // Create new message
        const msg = await interaction.channel.send({ embeds: [embed] });
        msgId = msg.id;
        chId = msg.channelId;
        // Add all reactions
        for (const e of Object.keys(mappings)) {
          await msg.react(e).catch(() => {});
        }
      }

      config.set("reaction_roles.message_id", msgId);
      config.set("reaction_roles.channel_id", chId);
      config.set("reaction_roles.mappings", mappings);

      await interaction.editReply(`✅ ${emoji} → <@&${role.id}> 매핑이 추가되었습니다.`);
    } catch (e) {
      console.error("[반응역할]", e.message);
      await interaction.editReply("❌ 반응 역할 설정 실패. 봇에 역할 관리 권한이 있는지 확인해주세요.");
    }
  }

  // /반응역할제거
  else if (commandName === "반응역할제거") {
    const emoji = interaction.options.getString("이모지").trim();
    const mappings = config.get("reaction_roles.mappings") || {};

    if (!(emoji in mappings)) {
      return interaction.reply({ content: "❌ 해당 이모지 매핑이 없습니다.", ephemeral: true });
    }

    delete mappings[emoji];
    config.set("reaction_roles.mappings", mappings);

    const msgId = config.get("reaction_roles.message_id");
    const chId = config.get("reaction_roles.channel_id");

    if (msgId && chId) {
      try {
        const channel = client.channels.cache.get(chId);
        const msg = await channel.messages.fetch(msgId);

        if (Object.keys(mappings).length === 0) {
          await msg.delete();
          config.set("reaction_roles.message_id", null);
          config.set("reaction_roles.channel_id", null);
        } else {
          const lines = Object.entries(mappings).map(([e, rId]) => `${e} → <@&${rId}>`);
          const embed = new EmbedBuilder()
            .setTitle("🎭 역할 선택")
            .setDescription("아래 이모지를 클릭해서 역할을 받으세요!\n다시 클릭하면 역할이 제거됩니다.\n\n" + lines.join("\n"))
            .setColor(0x5865f2);
          await msg.edit({ embeds: [embed] });
          // Remove the specific reaction
          const reactions = msg.reactions.cache.get(emoji);
          if (reactions) await reactions.remove().catch(() => {});
        }
      } catch (e) {
        console.warn("[반응역할제거]", e.message);
      }
    }

    await interaction.reply({ content: `✅ ${emoji} 매핑이 제거되었습니다.`, ephemeral: true });
  }

  // /반응역할초기화
  else if (commandName === "반응역할초기화") {
    const msgId = config.get("reaction_roles.message_id");
    const chId = config.get("reaction_roles.channel_id");

    if (msgId && chId) {
      try {
        const channel = client.channels.cache.get(chId);
        const msg = await channel.messages.fetch(msgId);
        await msg.delete();
      } catch {}
    }

    config.set("reaction_roles.message_id", null);
    config.set("reaction_roles.channel_id", null);
    config.set("reaction_roles.mappings", {});

    await interaction.reply({ content: "✅ 반응 역할이 초기화되었습니다.", ephemeral: true });
  }

  // /문구설정
  else if (commandName === "문구설정") {
    const type = interaction.options.getString("종류");
    const raw = interaction.options.getString("문구");
    const text = sanitizeText(raw, MAX_MESSAGE_LENGTH);
    const labels = {
      chzzk_start: "치지직 방송 시작 문구", chzzk_end: "치지직 방송 종료 문구", youtube_new: "YouTube 새 영상 문구",
      chzzk_start_title: "치지직 방송 시작 제목", chzzk_end_title: "치지직 방송 종료 제목", youtube_title: "YouTube 새 영상 제목",
    };

    config.set(`messages.${type}`, text);
    const hint = type.includes("title") ? "\n💡 `{name}`을 넣으면 채널명으로 바뀌어요!" : "";
    await interaction.reply(`✅ **${labels[type]}**이(가) 변경되었습니다.\n> ${text}${hint}`);
  }

  // /상태
  else if (commandName === "상태") {
    const notifId = config.get("notification_channel_id");
    const chzzkId = config.get("chzzk.channel_id");
    const chzzkName = config.get("chzzk.channel_name");
    const chzzkStatus = config.get("chzzk.last_status") || "CLOSE";
    const ytId = config.get("youtube.channel_id");
    const ytName = config.get("youtube.channel_name");

    const chzzkRoleId = config.get("mention_role_id");
    const ytRoleId = config.get("youtube_mention_role_id");
    const chzzkPing = chzzkRoleId === "everyone" ? "@everyone" : chzzkRoleId ? `<@&${chzzkRoleId}>` : "없음";
    const ytPing = ytRoleId === "everyone" ? "@everyone" : ytRoleId ? `<@&${ytRoleId}>` : "없음";

    const embed = new EmbedBuilder()
      .setTitle("📊 봇 설정 상태")
      .setColor(0x5865f2)
      .addFields(
        { name: "알림 채널", value: notifId ? `<#${notifId}>` : "미설정", inline: false },
        { name: "치지직 핑", value: chzzkPing, inline: true },
        { name: "YouTube 핑", value: ytPing, inline: true },
        { name: "\u200b", value: "\u200b", inline: false },
        { name: "치지직", value: chzzkId ? `${chzzkName || chzzkId} (${chzzkStatus === "OPEN" ? "🔴 방송 중" : "⚫ 오프라인"})` : "미설정", inline: false },
        { name: "YouTube", value: ytId ? (ytName || ytId) : "미설정", inline: false },
        { name: "📝 방송 시작 제목", value: config.get("messages.chzzk_start_title") || "🔴 {name} 방송 시작!", inline: true },
        { name: "📝 방송 시작 문구", value: config.get("messages.chzzk_start") || "언니 방송 시작했다구!! 빨리 놀러 와~ 💗", inline: true },
        { name: "\u200b", value: "\u200b", inline: false },
        { name: "📝 방송 종료 제목", value: config.get("messages.chzzk_end_title") || "⚫ {name} 방송 끝!", inline: true },
        { name: "📝 방송 종료 문구", value: config.get("messages.chzzk_end") || "오늘 방송 끝~! 다음에 또 보자 뿌잉 💤", inline: true },
        { name: "\u200b", value: "\u200b", inline: false },
        { name: "📝 YouTube 제목", value: config.get("messages.youtube_title") || "📺 새 영상 업로드!", inline: true },
        { name: "📝 YouTube 문구", value: config.get("messages.youtube_new") || "언니가 영상 올렸어!! 안 보면 손해야~ 🎬💕", inline: true },
      );

    await interaction.reply({ embeds: [embed] });
  }

  // /테스트
  else if (commandName === "테스트") {
    const notifId = config.get("notification_channel_id");
    if (!notifId) return interaction.reply({ content: "❌ 먼저 `/알림채널`로 알림 채널을 설정해주세요.", ephemeral: true });

    await interaction.deferReply();
    const notifChannel = client.channels.cache.get(notifId) || await client.channels.fetch(notifId).catch(() => null);
    if (!notifChannel) return interaction.editReply("❌ 알림 채널을 찾을 수 없습니다.");
    let sent = false;

    const chzzkRoleId = config.get("mention_role_id");
    const chzzkMention = chzzkRoleId === "everyone" ? "@everyone" : chzzkRoleId ? `<@&${chzzkRoleId}>` : "";
    const ytRoleId = config.get("youtube_mention_role_id");
    const ytMention = ytRoleId === "everyone" ? "@everyone" : ytRoleId ? `<@&${ytRoleId}>` : "";

    // Chzzk test
    const chzzkId = config.get("chzzk.channel_id");
    if (chzzkId) {
      try {
        const res = await fetch(`https://api.chzzk.naver.com/service/v3/channels/${chzzkId}/live-detail`, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const json = await res.json();
          const c = json.content || {};
          const ch = c.channel || {};
          const name = ch.channelName || "알 수 없음";
          const image = ch.channelImageUrl;
          const category = c.liveCategoryValue || c.liveCategory || "";

          // Start
          const testStartTitle = (config.get("messages.chzzk_start_title") || "🔴 {name} 방송 시작!").replace("{name}", name);
          const startDesc = config.get("embeds.chzzk_start_desc") || "";
          const startLiveTitle = c.liveTitle || "테스트 방송 제목";
          const startEmbed = new EmbedBuilder()
            .setTitle(testStartTitle)
            .setDescription(startDesc ? `${startDesc}\n\n${startLiveTitle}` : startLiveTitle)
            .setURL(`https://chzzk.naver.com/live/${chzzkId}`)
            .setColor(parseColor(config.get("embeds.chzzk_start_color"), 0x00ffa3))
            .setTimestamp()
            .setFooter({ text: "치지직" });

          if (image) startEmbed.setAuthor({ name, iconURL: image }).setThumbnail(image);
          if (category) startEmbed.addFields({ name: "카테고리", value: category, inline: true });

          const startText = config.get("messages.chzzk_start") || "언니 방송 시작했다구!! 빨리 놀러 와~ 💗";
          const startMsg = chzzkMention ? `${chzzkMention}\n${startText}` : startText;
          await notifChannel.send({ content: startMsg, embeds: [startEmbed] });

          // End
          const testEndTitle = (config.get("messages.chzzk_end_title") || "⚫ {name} 방송 끝!").replace("{name}", name);
          const endDesc = config.get("embeds.chzzk_end_desc") || "";
          const endEmbed = new EmbedBuilder()
            .setTitle(testEndTitle)
            .setURL(`https://chzzk.naver.com/live/${chzzkId}`)
            .setColor(parseColor(config.get("embeds.chzzk_end_color"), 0x808080))
            .setTimestamp()
            .setFooter({ text: "치지직" });

          if (endDesc) endEmbed.setDescription(endDesc);
          if (image) endEmbed.setAuthor({ name, iconURL: image }).setThumbnail(image);

          const endText = config.get("messages.chzzk_end") || "오늘 방송 끝~! 다음에 또 보자 뿌잉 💤";
          await notifChannel.send({ content: endText, embeds: [endEmbed] });
          sent = true;
        }
      } catch (e) {
        console.warn("[테스트] 치지직 실패:", e.message);
      }
    }

    // YouTube test
    const ytId = config.get("youtube.channel_id");
    if (ytId) {
      try {
        const RSSParser = require("rss-parser");
        const rss = new RSSParser({ customFields: { item: [["yt:videoId", "ytVideoId"]] } });
        const feed = await rss.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(ytId)}`);
        if (feed.items?.length) {
          const latest = feed.items[0];
          const videoId = latest.ytVideoId || latest.id?.split(":").pop();
          const channelName = latest.author || feed.title || "";

          const testYtTitle = config.get("messages.youtube_title") || "📺 새 영상 업로드!";
          const ytDesc = config.get("embeds.youtube_desc") || "";
          const vidTitle = latest.title || "";
          const embed = new EmbedBuilder()
            .setTitle(testYtTitle)
            .setDescription(ytDesc ? `${ytDesc}\n\n${vidTitle}` : vidTitle)
            .setURL(latest.link || `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`)
            .setColor(parseColor(config.get("embeds.youtube_color"), 0xff0000))
            .setImage(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`)
            .setTimestamp()
            .setFooter({ text: "YouTube" });

          if (channelName) embed.setAuthor({ name: channelName });

          const ytText = config.get("messages.youtube_new") || "언니가 영상 올렸어!! 안 보면 손해야~ 🎬💕";
          const ytMsg = ytMention ? `${ytMention}\n${ytText}` : ytText;
          await notifChannel.send({ content: ytMsg, embeds: [embed] });
          sent = true;
        }
      } catch (e) {
        console.warn("[테스트] YouTube 실패:", e.message);
      }
    }

    if (sent) await interaction.editReply("✅ 테스트 알림을 전송했습니다! (치지직 시작/종료 + YouTube)");
    else await interaction.editReply("❌ 모니터링할 채널이 설정되지 않았습니다.");
  }

  // /굿즈
  else if (commandName === "굿즈") {
    const goodsUrl = config.get("goods.url");
    if (!goodsUrl) {
      return interaction.reply({ content: "📭 굿즈가 아직 설정되지 않았어요. 관리자가 `/굿즈설정`으로 설정해주세요!", ephemeral: true });
    }

    const title = config.get("goods.title") || "🛍️ 굿즈샵";
    const desc = config.get("goods.description") || "";

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setURL(goodsUrl)
      .setColor(0xFF69B4)
      .setTimestamp();

    if (desc) embed.setDescription(desc);

    await interaction.reply({ embeds: [embed] });
  }

  // /굿즈설정
  else if (commandName === "굿즈설정") {
    const url = interaction.options.getString("url");
    const title = interaction.options.getString("제목");
    const desc = interaction.options.getString("문구");
    const changes = [];

    if (url) {
      try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          return interaction.reply({ content: "❌ https:// 로 시작하는 URL만 가능합니다.", ephemeral: true });
        }
      } catch {
        return interaction.reply({ content: "❌ 올바른 URL을 입력해주세요.", ephemeral: true });
      }
      config.set("goods.url", url);
      changes.push(`URL → ${url}`);
    }

    if (title) {
      config.set("goods.title", sanitizeText(title, 200));
      changes.push(`제목 → ${title}`);
    }

    if (desc) {
      config.set("goods.description", sanitizeText(desc, MAX_EMBED_DESC_LENGTH));
      changes.push(`문구 → ${desc}`);
    }

    if (changes.length === 0) {
      return interaction.reply({ content: "❌ URL, 제목, 문구 중 하나는 입력해주세요.", ephemeral: true });
    }

    await interaction.reply(`✅ 굿즈 설정이 변경되었습니다.\n${changes.join("\n")}`);
  }

  // /클립
  else if (commandName === "클립") {
    const clips = config.get("clips") || [];
    if (clips.length === 0) {
      return interaction.reply({ content: "📭 등록된 클립이 없어요. `/클립추가`로 클립을 추가해주세요!", ephemeral: true });
    }

    const clip = clips[Math.floor(Math.random() * clips.length)];
    const embed = new EmbedBuilder()
      .setTitle(`🎬 ${clip.title}`)
      .setURL(clip.url)
      .setColor(0xFF69B4)
      .setFooter({ text: `클립 ${clips.indexOf(clip) + 1}/${clips.length}` });

    await interaction.reply({ embeds: [embed] });
  }

  // /클립추가
  else if (commandName === "클립추가") {
    const title = sanitizeText(interaction.options.getString("제목"), 100);
    const url = interaction.options.getString("url").trim();

    // URL validation
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return interaction.reply({ content: "❌ https:// 로 시작하는 URL만 가능합니다.", ephemeral: true });
      }
    } catch {
      return interaction.reply({ content: "❌ 올바른 URL을 입력해주세요.", ephemeral: true });
    }

    const clips = config.get("clips") || [];
    if (clips.length >= 100) {
      return interaction.reply({ content: "❌ 클립은 최대 100개까지 등록 가능합니다.", ephemeral: true });
    }

    clips.push({ title, url });
    config.set("clips", clips);

    await interaction.reply(`✅ 클립이 추가되었습니다! (총 ${clips.length}개)\n> **${title}**`);
  }

  // /클립목록
  else if (commandName === "클립목록") {
    const clips = config.get("clips") || [];
    if (clips.length === 0) {
      return interaction.reply({ content: "📭 등록된 클립이 없어요.", ephemeral: true });
    }

    const list = clips.map((c, i) => `**${i + 1}.** [${c.title}](${c.url})`).join("\n");
    const embed = new EmbedBuilder()
      .setTitle(`🎬 클립 목록 (${clips.length}개)`)
      .setDescription(list.slice(0, 4000))
      .setColor(0xFF69B4);

    await interaction.reply({ embeds: [embed] });
  }

  // /클립삭제
  else if (commandName === "클립삭제") {
    const num = interaction.options.getInteger("번호");
    const clips = config.get("clips") || [];

    if (num < 1 || num > clips.length) {
      return interaction.reply({ content: `❌ 1~${clips.length} 사이의 번호를 입력해주세요.`, ephemeral: true });
    }

    const removed = clips.splice(num - 1, 1)[0];
    config.set("clips", clips);

    await interaction.reply({ content: `✅ 클립 삭제됨: **${removed.title}** (남은 ${clips.length}개)`, ephemeral: true });
  }
}

// ── Reaction role events ──
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const msgId = config.get("reaction_roles.message_id");
    if (reaction.message.id !== msgId) return;

    const mappings = config.get("reaction_roles.mappings") || {};
    const emoji = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    const roleId = mappings[emoji];
    if (!roleId) return;

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    await member.roles.add(roleId);
    console.log(`[반응역할] ${user.tag} +역할 ${roleId}`);
  } catch (e) {
    console.error("[반응역할] 역할 부여 실패:", e.message);
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const msgId = config.get("reaction_roles.message_id");
    if (reaction.message.id !== msgId) return;

    const mappings = config.get("reaction_roles.mappings") || {};
    const emoji = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    const roleId = mappings[emoji];
    if (!roleId) return;

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    await member.roles.remove(roleId);
    console.log(`[반응역할] ${user.tag} -역할 ${roleId}`);
  } catch (e) {
    console.error("[반응역할] 역할 제거 실패:", e.message);
  }
});

// ── Global error handlers ──
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err?.message || err);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err?.message || err);
  // Let the process exit for truly fatal errors
  if (err?.code === "ERR_SOCKET_CLOSED" || err?.message?.includes("ECONNRESET")) return;
  process.exit(1);
});

// ── Bot start ──
client.once("ready", async () => {
  console.log(`봇 로그인 완료: ${client.user.tag}`);
  console.log(`접속 서버: ${client.guilds.cache.map((g) => g.name).join(", ") || "없음"}`);

  const rest = new REST().setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: commands.map((c) => c.toJSON()),
  });
  console.log("슬래시 커맨드 등록 완료");

  chzzk.start(client);
  youtube.start(client);
});

client.login(TOKEN);
