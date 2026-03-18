const { EmbedBuilder } = require("discord.js");
const RSSParser = require("rss-parser");
const config = require("./config");

const parser = new RSSParser({
  customFields: { item: [["yt:videoId", "ytVideoId"]] },
});

const FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={id}";

function parseColor(hex, fallback) {
  if (!hex) return fallback;
  const n = parseInt(hex.replace("#", ""), 16);
  return isNaN(n) ? fallback : n;
}

async function check(client) {
  const channelId = config.get("youtube.channel_id");
  const notifId = config.get("notification_channel_id");
  if (!channelId || !notifId) return;

  let feed;
  try {
    feed = await parser.parseURL(FEED_URL.replace("{id}", encodeURIComponent(channelId)));
  } catch (e) {
    console.warn("[YouTube] RSS 요청 실패:", e.message);
    return;
  }

  if (!feed.items || feed.items.length === 0) return;

  const latest = feed.items[0];
  const videoId = latest.ytVideoId || latest.id?.split(":").pop();
  if (!videoId) return;

  const lastVideoId = config.get("youtube.last_video_id");

  if (lastVideoId === null) {
    config.set("youtube.last_video_id", videoId);
    config.set("youtube.channel_name", latest.author || feed.title || null);
    console.log(`[YouTube] 최초 영상 ID 기록: ${videoId}`);
    return;
  }

  if (videoId === lastVideoId) return;

  const videoTitle = latest.title || "";
  const channelName = latest.author || feed.title || "";
  const videoUrl = latest.link || `https://www.youtube.com/watch?v=${videoId}`;
  const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const customDesc = config.get("embeds.youtube_desc") || "";
  const description = customDesc ? `${customDesc}\n\n${videoTitle}` : videoTitle;
  const color = parseColor(config.get("embeds.youtube_color"), 0xff0000);
  const ytTitle = config.get("messages.youtube_title") || "📺 새 영상 업로드!";

  const embed = new EmbedBuilder()
    .setTitle(ytTitle)
    .setDescription(description)
    .setURL(videoUrl)
    .setColor(color)
    .setImage(thumbnail)
    .setTimestamp();

  if (channelName) embed.setAuthor({ name: channelName });
  embed.addFields({ name: "채널", value: channelName || "알 수 없음", inline: true });
  if (latest.pubDate) embed.addFields({ name: "업로드", value: new Date(latest.pubDate).toLocaleDateString("ko-KR"), inline: true });
  embed.setFooter({ text: "YouTube" });

  const roleId = config.get("youtube_mention_role_id");
  const mention = roleId === "everyone" ? "@everyone" : roleId ? `<@&${roleId}>` : "";
  const ytText = config.get("messages.youtube_new") || "언니가 영상 올렸어!! 안 보면 손해야~ 🎬💕";
  const msg = mention ? `${mention}\n${ytText}` : ytText;

  const notifChannel = client.channels.cache.get(notifId) || await client.channels.fetch(notifId).catch(() => null);
  if (notifChannel) {
    try {
      await notifChannel.send({ content: msg, embeds: [embed] });
      console.log(`[YouTube] 새 영상 알림 전송: ${videoTitle}`);
    } catch (e) {
      console.error("[YouTube] 알림 전송 실패:", e.message);
    }
  }

  config.set("youtube.last_video_id", videoId);
  if (channelName) config.set("youtube.channel_name", channelName);
}

function start(client) {
  setInterval(() => check(client), 3 * 60_000);
  console.log("[YouTube] 모니터링 시작 (3분 간격)");
}

module.exports = { start, check };
