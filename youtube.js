const { EmbedBuilder } = require("discord.js");
const RSSParser = require("rss-parser");
const config = require("./config");

const parser = new RSSParser({
  customFields: { item: [["yt:videoId", "ytVideoId"]] },
});

// Long-form videos use the channel feed (UC prefix).
// Shorts are excluded from that feed; YouTube's auto-generated "UUSH" playlist
// (uploads-shorts) returns shorts-only items.
const VIDEO_FEED = "https://www.youtube.com/feeds/videos.xml?channel_id={id}";
const SHORTS_FEED = "https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH{suffix}";

const TARGETS = [
  { configKey: "youtube", isSub: false },
  { configKey: "youtube_sub", isSub: true },
];

function parseColor(hex, fallback) {
  if (!hex) return fallback;
  const n = parseInt(hex.replace("#", ""), 16);
  return isNaN(n) ? fallback : n;
}

async function fetchFeed(url) {
  try {
    return await parser.parseURL(url);
  } catch (e) {
    console.warn(`[YouTube] RSS 요청 실패 (${url}):`, e.message);
    return null;
  }
}

function pickLatestId(feed) {
  if (!feed?.items?.length) return null;
  const item = feed.items[0];
  return {
    item,
    videoId: item.ytVideoId || item.id?.split(":").pop() || null,
  };
}

async function sendNotification(client, notifId, { item, videoId, isShort, isSub, channelName }) {
  const videoTitle = item.title || "";
  const url = isShort
    ? `https://www.youtube.com/shorts/${videoId}`
    : (item.link || `https://www.youtube.com/watch?v=${videoId}`);
  const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const customDesc = config.get("embeds.youtube_desc") || "";
  const description = customDesc ? `${customDesc}\n\n${videoTitle}` : videoTitle;
  const color = parseColor(config.get("embeds.youtube_color"), 0xff0000);
  const defaultTitle = isShort ? "🩳 새 Shorts 업로드!" : "📺 새 영상 업로드!";
  const ytTitle = isShort
    ? (config.get("messages.youtube_shorts_title") || defaultTitle)
    : (config.get("messages.youtube_title") || defaultTitle);

  const embed = new EmbedBuilder()
    .setTitle(ytTitle)
    .setDescription(description)
    .setURL(url)
    .setColor(color)
    .setImage(thumbnail)
    .setTimestamp();

  if (channelName) embed.setAuthor({ name: channelName });
  embed.addFields({ name: "채널", value: channelName || "알 수 없음", inline: true });
  if (item.pubDate) embed.addFields({ name: "업로드", value: new Date(item.pubDate).toLocaleDateString("ko-KR"), inline: true });
  embed.setFooter({ text: isShort ? "YouTube Shorts" : "YouTube" });

  const roleId = config.get("youtube_mention_role_id");
  const mention = roleId === "everyone" ? "@everyone" : roleId ? `<@&${roleId}>` : "";

  let ytText;
  if (isSub) {
    ytText = config.get("messages.youtube_sub_new") || "언니의 부채널에도 영상이 올라왔어~";
  } else {
    const defaultText = isShort
      ? "언니가 Shorts 올렸어! 짧고 굵게 보러가자~ 🩳✨"
      : "언니가 영상 올렸어!! 안 보면 손해야~ 🎬💕";
    ytText = isShort
      ? (config.get("messages.youtube_shorts_new") || defaultText)
      : (config.get("messages.youtube_new") || defaultText);
  }
  const msg = mention ? `${mention}\n${ytText}` : ytText;

  const notifChannel = client.channels.cache.get(notifId) || await client.channels.fetch(notifId).catch(() => null);
  if (!notifChannel) return;

  try {
    await notifChannel.send({ content: msg, embeds: [embed] });
    const label = isSub ? "부채널 " : "";
    console.log(`[YouTube] ${label}${isShort ? "Shorts" : "새 영상"} 알림 전송: ${videoTitle}`);
  } catch (e) {
    console.error("[YouTube] 알림 전송 실패:", e.message);
  }
}

async function checkTarget(client, notifId, { configKey, isSub }) {
  const channelId = config.get(`${configKey}.channel_id`);
  if (!channelId) return;

  const suffix = channelId.replace(/^UC/, "");
  const [videoFeed, shortsFeed] = await Promise.all([
    fetchFeed(VIDEO_FEED.replace("{id}", encodeURIComponent(channelId))),
    fetchFeed(SHORTS_FEED.replace("{suffix}", encodeURIComponent(suffix))),
  ]);

  const latestVideo = pickLatestId(videoFeed);
  const latestShort = pickLatestId(shortsFeed);

  const channelName =
    latestVideo?.item?.author ||
    videoFeed?.title ||
    latestShort?.item?.author ||
    null;

  // Long-form video tracking
  if (latestVideo?.videoId) {
    const lastVideoId = config.get(`${configKey}.last_video_id`);
    if (lastVideoId === null) {
      config.set(`${configKey}.last_video_id`, latestVideo.videoId);
      if (channelName) config.set(`${configKey}.channel_name`, channelName);
      console.log(`[YouTube] ${isSub ? "부채널 " : ""}최초 영상 ID 기록: ${latestVideo.videoId}`);
    } else if (latestVideo.videoId !== lastVideoId) {
      await sendNotification(client, notifId, {
        item: latestVideo.item,
        videoId: latestVideo.videoId,
        isShort: false,
        isSub,
        channelName,
      });
      config.set(`${configKey}.last_video_id`, latestVideo.videoId);
      if (channelName) config.set(`${configKey}.channel_name`, channelName);
    }
  }

  // Shorts tracking
  if (latestShort?.videoId) {
    const lastShortId = config.get(`${configKey}.last_short_id`);
    if (lastShortId === null) {
      config.set(`${configKey}.last_short_id`, latestShort.videoId);
      console.log(`[YouTube] ${isSub ? "부채널 " : ""}최초 Shorts ID 기록: ${latestShort.videoId}`);
    } else if (latestShort.videoId !== lastShortId) {
      await sendNotification(client, notifId, {
        item: latestShort.item,
        videoId: latestShort.videoId,
        isShort: true,
        isSub,
        channelName,
      });
      config.set(`${configKey}.last_short_id`, latestShort.videoId);
    }
  }
}

async function check(client) {
  const notifId = config.get("notification_channel_id");
  if (!notifId) return;
  for (const target of TARGETS) {
    await checkTarget(client, notifId, target);
  }
}

function start(client) {
  setInterval(() => check(client), 3 * 60_000);
  console.log("[YouTube] 모니터링 시작 (3분 간격, 메인+부채널 영상+Shorts)");
}

module.exports = { start, check };
