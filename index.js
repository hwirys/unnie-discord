require("dotenv").config();

const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, REST, Routes, Collection } = require("discord.js");
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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
    .setName("상태")
    .setDescription("현재 봇 설정 상태를 표시합니다"),

  new SlashCommandBuilder()
    .setName("테스트")
    .setDescription("치지직/YouTube 알림을 테스트합니다")
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
    const target = interaction.options.getString("대상");

    if (target === "everyone") {
      config.set("mention_role_id", "everyone");
      await interaction.reply("✅ 알림 시 `@everyone`을 멘션합니다.");
    } else if (target === "role") {
      const role = interaction.options.getRole("역할");
      if (!role) return interaction.reply("❌ 역할을 선택해주세요.");
      config.set("mention_role_id", role.id);
      await interaction.reply(`✅ 알림 시 <@&${role.id}> 역할을 멘션합니다.`);
    } else {
      config.set("mention_role_id", null);
      await interaction.reply("✅ 알림 시 멘션을 하지 않습니다.");
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

    const roleId = config.get("mention_role_id");
    const mentionText = roleId === "everyone" ? "@everyone" : roleId ? `<@&${roleId}>` : "없음";

    const embed = new EmbedBuilder()
      .setTitle("📊 봇 설정 상태")
      .setColor(0x5865f2)
      .addFields(
        { name: "알림 채널", value: notifId ? `<#${notifId}>` : "미설정", inline: false },
        { name: "알림 핑", value: mentionText, inline: false },
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

    const notifChannel = client.channels.cache.get(notifId);
    if (!notifChannel) return interaction.reply({ content: "❌ 알림 채널을 찾을 수 없습니다.", ephemeral: true });

    await interaction.deferReply();
    let sent = false;

    const roleId = config.get("mention_role_id");
    const mention = roleId === "everyone" ? "@everyone" : roleId ? `<@&${roleId}>` : "";

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
            .setFooter({ text: "치지직 | ⚠️ 테스트 알림" });

          if (image) startEmbed.setAuthor({ name, iconURL: image }).setThumbnail(image);
          if (category) startEmbed.addFields({ name: "카테고리", value: category, inline: true });

          const startText = config.get("messages.chzzk_start") || "언니 방송 시작했다구!! 빨리 놀러 와~ 💗";
          const startMsg = mention ? `${mention}\n${startText}` : startText;
          await notifChannel.send({ content: `⚠️ **테스트**\n${startMsg}`, embeds: [startEmbed] });

          // End
          const testEndTitle = (config.get("messages.chzzk_end_title") || "⚫ {name} 방송 끝!").replace("{name}", name);
          const endDesc = config.get("embeds.chzzk_end_desc") || "";
          const endEmbed = new EmbedBuilder()
            .setTitle(testEndTitle)
            .setURL(`https://chzzk.naver.com/live/${chzzkId}`)
            .setColor(parseColor(config.get("embeds.chzzk_end_color"), 0x808080))
            .setTimestamp()
            .setFooter({ text: "치지직 | ⚠️ 테스트 알림" });

          if (endDesc) endEmbed.setDescription(endDesc);
          if (image) endEmbed.setAuthor({ name, iconURL: image }).setThumbnail(image);

          const endText = config.get("messages.chzzk_end") || "오늘 방송 끝~! 다음에 또 보자 뿌잉 💤";
          await notifChannel.send({ content: `⚠️ **테스트**\n${endText}`, embeds: [endEmbed] });
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
            .setFooter({ text: "YouTube | ⚠️ 테스트 알림" });

          if (channelName) embed.setAuthor({ name: channelName });

          const ytText = config.get("messages.youtube_new") || "언니가 영상 올렸어!! 안 보면 손해야~ 🎬💕";
          const ytMsg = mention ? `${mention}\n${ytText}` : ytText;
          await notifChannel.send({ content: `⚠️ **테스트**\n${ytMsg}`, embeds: [embed] });
          sent = true;
        }
      } catch (e) {
        console.warn("[테스트] YouTube 실패:", e.message);
      }
    }

    if (sent) await interaction.editReply("✅ 테스트 알림을 전송했습니다! (치지직 시작/종료 + YouTube)");
    else await interaction.editReply("❌ 모니터링할 채널이 설정되지 않았습니다.");
  }
}

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
