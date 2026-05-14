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
// Community posts: no official feed — local RSSHub container handles it.
const RSSHUB_BASE = process.env.RSSHUB_BASE || "http://localhost:1200";
const COMMUNITY_FEED = `${RSSHUB_BASE}/youtube/community/{id}`;

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

function pickLatestPost(feed) {
  if (!feed?.items?.length) return null;
  const item = feed.items[0];
  const link = item.link || item.guid || "";
  const m = /\/post\/([A-Za-z0-9_-]+)/.exec(link);
  return { item, postId: m ? m[1] : link, link };
}

function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstImageFromHtml(html) {
  if (!html) return null;
  const m = /<img[^>]+src="([^"]+)"/i.exec(html);
  return m ? m[1] : null;
}

// Ring-buffer dedup: YouTube RSS occasionally reorders or returns partial entries,
// so feed.items[0] can toggle between two recently-published videos. Tracking a
// single "last_id" makes both look "new" on alternating polls and notifications
// ping-pong forever. We keep the last N seen IDs per channel and only notify on
// IDs that have never been seen.
const SEEN_BUFFER_SIZE = 50;

function hasSeen(configKey, listKey, id) {
  const arr = config.get(`${configKey}.${listKey}`);
  return Array.isArray(arr) && arr.includes(id);
}

function markSeen(configKey, listKey, id) {
  let arr = config.get(`${configKey}.${listKey}`);
  if (!Array.isArray(arr)) arr = [];
  if (arr.includes(id)) return;
  arr.unshift(id);
  if (arr.length > SEEN_BUFFER_SIZE) arr.length = SEEN_BUFFER_SIZE;
  config.set(`${configKey}.${listKey}`, arr);
}

function migrateSingleToBuffer(configKey, singleKey, listKey) {
  const existing = config.get(`${configKey}.${listKey}`);
  if (Array.isArray(existing) && existing.length > 0) return;
  const single = config.get(`${configKey}.${singleKey}`);
  if (single) markSeen(configKey, listKey, single);
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

async function sendPostNotification(client, notifId, { item, postId, link, isSub, channelName }) {
  const rawDesc = item.content || item["content:encoded"] || item.description || item.summary || "";
  const text = htmlToText(rawDesc);
  const image = firstImageFromHtml(rawDesc);
  const url = link || `https://www.youtube.com/post/${postId}`;

  const truncated = text.length > 1500 ? text.slice(0, 1500) + "…" : text;
  const color = parseColor(config.get("embeds.youtube_color"), 0xff0000);
  const titleKey = isSub ? "messages.youtube_post_title" : "messages.youtube_post_title";
  const ytTitle = config.get(titleKey) || "📝 새 커뮤니티 게시물!";

  const embed = new EmbedBuilder()
    .setTitle(ytTitle)
    .setURL(url)
    .setColor(color)
    .setTimestamp();

  if (truncated) embed.setDescription(truncated);
  if (channelName) embed.setAuthor({ name: channelName });
  if (image) embed.setImage(image);
  embed.addFields({ name: "채널", value: channelName || "알 수 없음", inline: true });
  if (item.pubDate) embed.addFields({ name: "작성", value: new Date(item.pubDate).toLocaleDateString("ko-KR"), inline: true });
  embed.setFooter({ text: "YouTube Community" });

  const roleId = config.get("youtube_mention_role_id");
  const mention = roleId === "everyone" ? "@everyone" : roleId ? `<@&${roleId}>` : "";
  const defaultText = isSub
    ? "부채널에 새 커뮤니티 게시물이 올라왔어~ 📝"
    : "언니가 새 커뮤니티 게시물을 올렸어! 📝";
  const ytText = isSub
    ? (config.get("messages.youtube_post_sub_new") || defaultText)
    : (config.get("messages.youtube_post_new") || defaultText);
  const msg = mention ? `${mention}\n${ytText}` : ytText;

  const notifChannel = client.channels.cache.get(notifId) || await client.channels.fetch(notifId).catch(() => null);
  if (!notifChannel) return;

  try {
    await notifChannel.send({ content: msg, embeds: [embed] });
    console.log(`[YouTube] ${isSub ? "부채널 " : ""}새 게시물 알림 전송: ${postId}`);
  } catch (e) {
    console.error("[YouTube] 게시물 알림 전송 실패:", e.message);
  }
}

async function checkTarget(client, notifId, { configKey, isSub }) {
  const channelId = config.get(`${configKey}.channel_id`);
  if (!channelId) return;

  const suffix = channelId.replace(/^UC/, "");
  const [videoFeed, shortsFeed, postFeed] = await Promise.all([
    fetchFeed(VIDEO_FEED.replace("{id}", encodeURIComponent(channelId))),
    fetchFeed(SHORTS_FEED.replace("{suffix}", encodeURIComponent(suffix))),
    fetchFeed(COMMUNITY_FEED.replace("{id}", encodeURIComponent(channelId))),
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
    migrateSingleToBuffer(configKey, "last_video_id", "seen_video_ids");
    const seenList = config.get(`${configKey}.seen_video_ids`);
    const isFirstEver = !Array.isArray(seenList) || seenList.length === 0;
    if (isFirstEver) {
      markSeen(configKey, "seen_video_ids", latestVideo.videoId);
      config.set(`${configKey}.last_video_id`, latestVideo.videoId);
      if (channelName) config.set(`${configKey}.channel_name`, channelName);
      console.log(`[YouTube] ${isSub ? "부채널 " : ""}최초 영상 ID 기록: ${latestVideo.videoId}`);
    } else if (!hasSeen(configKey, "seen_video_ids", latestVideo.videoId)) {
      await sendNotification(client, notifId, {
        item: latestVideo.item,
        videoId: latestVideo.videoId,
        isShort: false,
        isSub,
        channelName,
      });
      markSeen(configKey, "seen_video_ids", latestVideo.videoId);
      config.set(`${configKey}.last_video_id`, latestVideo.videoId);
      if (channelName) config.set(`${configKey}.channel_name`, channelName);
    }
  }

  // Shorts tracking
  if (latestShort?.videoId) {
    migrateSingleToBuffer(configKey, "last_short_id", "seen_short_ids");
    const seenList = config.get(`${configKey}.seen_short_ids`);
    const isFirstEver = !Array.isArray(seenList) || seenList.length === 0;
    if (isFirstEver) {
      markSeen(configKey, "seen_short_ids", latestShort.videoId);
      config.set(`${configKey}.last_short_id`, latestShort.videoId);
      console.log(`[YouTube] ${isSub ? "부채널 " : ""}최초 Shorts ID 기록: ${latestShort.videoId}`);
    } else if (!hasSeen(configKey, "seen_short_ids", latestShort.videoId)) {
      await sendNotification(client, notifId, {
        item: latestShort.item,
        videoId: latestShort.videoId,
        isShort: true,
        isSub,
        channelName,
      });
      markSeen(configKey, "seen_short_ids", latestShort.videoId);
      config.set(`${configKey}.last_short_id`, latestShort.videoId);
    }
  }

  // Community post tracking (via RSSHub)
  const latestPost = pickLatestPost(postFeed);
  if (latestPost?.postId) {
    migrateSingleToBuffer(configKey, "last_post_id", "seen_post_ids");
    const seenList = config.get(`${configKey}.seen_post_ids`);
    const isFirstEver = !Array.isArray(seenList) || seenList.length === 0;
    if (isFirstEver) {
      markSeen(configKey, "seen_post_ids", latestPost.postId);
      config.set(`${configKey}.last_post_id`, latestPost.postId);
      console.log(`[YouTube] ${isSub ? "부채널 " : ""}최초 게시물 ID 기록: ${latestPost.postId}`);
    } else if (!hasSeen(configKey, "seen_post_ids", latestPost.postId)) {
      await sendPostNotification(client, notifId, {
        item: latestPost.item,
        postId: latestPost.postId,
        link: latestPost.link,
        isSub,
        channelName,
      });
      markSeen(configKey, "seen_post_ids", latestPost.postId);
      config.set(`${configKey}.last_post_id`, latestPost.postId);
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
