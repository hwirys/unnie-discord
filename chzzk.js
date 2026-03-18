const { EmbedBuilder } = require("discord.js");
const config = require("./config");

const API_URL = "https://api.chzzk.naver.com/service/v3/channels/{id}/live-detail";

function parseColor(hex, fallback) {
  if (!hex) return fallback;
  const n = parseInt(hex.replace("#", ""), 16);
  return isNaN(n) ? fallback : n;
}

async function check(client) {
  const channelId = config.get("chzzk.channel_id");
  const notifId = config.get("notification_channel_id");
  if (!channelId || !notifId) return;

  let content;
  try {
    const res = await fetch(API_URL.replace("{id}", channelId), {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    const json = await res.json();
    content = json.content;
    if (!content) return;
  } catch (e) {
    console.warn("[치지직] API 요청 실패:", e.message);
    return;
  }

  const current = content.status || "CLOSE";
  const previous = config.get("chzzk.last_status") || "CLOSE";
  const notifChannel = client.channels.cache.get(notifId);
  if (!notifChannel) return;

  const ch = content.channel || {};
  const name = ch.channelName || "알 수 없음";
  const image = ch.channelImageUrl;

  const roleId = config.get("mention_role_id");
  const mention = roleId === "everyone" ? "@everyone" : roleId ? `<@&${roleId}>` : "";

  if (current === "OPEN" && previous === "CLOSE") {
    const liveTitle = content.liveTitle || "";
    const category = content.liveCategoryValue || content.liveCategory || "";
    const viewers = content.concurrentUserCount || 0;
    let thumb = content.liveImageUrl;
    if (thumb) thumb = thumb.replace("{type}", "480");

    const customDesc = config.get("embeds.chzzk_start_desc") || "";
    const description = customDesc ? `${customDesc}\n\n${liveTitle}` : liveTitle;

    const startTitle = (config.get("messages.chzzk_start_title") || "🔴 {name} 방송 시작!").replace("{name}", name);
    const color = parseColor(config.get("embeds.chzzk_start_color"), 0x00ffa3);

    const embed = new EmbedBuilder()
      .setTitle(startTitle)
      .setDescription(description)
      .setURL(`https://chzzk.naver.com/live/${channelId}`)
      .setColor(color)
      .setTimestamp();

    if (image) embed.setAuthor({ name, iconURL: image }).setThumbnail(image);
    if (thumb) embed.setImage(thumb);
    if (category) embed.addFields({ name: "카테고리", value: category, inline: true });
    if (viewers) embed.addFields({ name: "시청자 수", value: `${viewers.toLocaleString()}명`, inline: true });
    embed.setFooter({ text: "치지직" });

    const startText = config.get("messages.chzzk_start") || "언니 방송 시작했다구!! 빨리 놀러 와~ 💗";
    const msg = mention ? `${mention}\n${startText}` : startText;

    try {
      await notifChannel.send({ content: msg, embeds: [embed] });
      console.log(`[치지직] 라이브 알림 전송: ${name}`);
    } catch (e) {
      console.error("[치지직] 알림 전송 실패:", e.message);
    }

    config.set("chzzk.last_status", "OPEN");
    config.set("chzzk.channel_name", name);

  } else if (current === "CLOSE" && previous === "OPEN") {
    const customDesc = config.get("embeds.chzzk_end_desc") || "";
    const endTitle = (config.get("messages.chzzk_end_title") || "⚫ {name} 방송 끝!").replace("{name}", name);
    const color = parseColor(config.get("embeds.chzzk_end_color"), 0x808080);

    const embed = new EmbedBuilder()
      .setTitle(endTitle)
      .setURL(`https://chzzk.naver.com/live/${channelId}`)
      .setColor(color)
      .setTimestamp();

    if (customDesc) embed.setDescription(customDesc);
    if (image) embed.setAuthor({ name, iconURL: image }).setThumbnail(image);
    embed.setFooter({ text: "치지직" });

    try {
      const endText = config.get("messages.chzzk_end") || "오늘 방송 끝~! 다음에 또 보자 뿌잉 💤";
      await notifChannel.send({ content: endText, embeds: [embed] });
      console.log(`[치지직] 방송 종료 알림 전송: ${name}`);
    } catch (e) {
      console.error("[치지직] 종료 알림 전송 실패:", e.message);
    }

    config.set("chzzk.last_status", "CLOSE");
  }
}

function start(client) {
  setInterval(() => check(client), 30_000);
  console.log("[치지직] 모니터링 시작 (30초 간격)");
}

module.exports = { start, check };
