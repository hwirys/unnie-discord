const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const ALLOWED_TOP_KEYS = new Set([
  "notification_channel_id", "mention_role_id", "youtube_mention_role_id", "messages", "embeds", "chzzk", "youtube", "reaction_roles", "clips", "goods",
]);

const DEFAULT_CONFIG = {
  notification_channel_id: null,
  mention_role_id: null,
  youtube_mention_role_id: null,
  messages: {
    chzzk_start: "언니 방송 시작했다구!! 빨리 놀러 와~ 💗",
    chzzk_end: "오늘 방송 끝~! 다음에 또 보자 뿌잉 💤",
    youtube_new: "언니가 영상 올렸어!! 안 보면 손해야~ 🎬💕",
    chzzk_start_title: "🔴 {name} 방송 시작!",
    chzzk_end_title: "⚫ {name} 방송 끝!",
    youtube_title: "📺 새 영상 업로드!",
  },
  embeds: {
    chzzk_start_color: "#00FFA3",
    chzzk_start_desc: "",
    chzzk_end_color: "#808080",
    chzzk_end_desc: "",
    youtube_color: "#FF0000",
    youtube_desc: "",
  },
  reaction_roles: {
    message_id: null,
    channel_id: null,
    mappings: {},
  },
  goods: {
    url: null,
    title: "🛍️ 굿즈샵",
    description: null,
  },
  clips: [],
  chzzk: {
    channel_id: null,
    last_status: "CLOSE",
    channel_name: null,
  },
  youtube: {
    channel_id: null,
    last_video_id: null,
    channel_name: null,
  },
};

let data = {};

function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      // Only accept plain objects
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed;
      } else {
        data = {};
      }
    }
  } catch {
    data = {};
  }
  // Merge defaults
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    if (!(key in data)) {
      data[key] = JSON.parse(JSON.stringify(value));
    } else if (typeof value === "object" && value !== null) {
      for (const [sub, subVal] of Object.entries(value)) {
        if (!(sub in data[key])) data[key][sub] = subVal;
      }
    }
  }
  // Remove unknown top-level keys
  for (const key of Object.keys(data)) {
    if (!ALLOWED_TOP_KEYS.has(key)) delete data[key];
  }
}

function save() {
  try {
    const tmp = CONFIG_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (e) {
    console.error("[config] 저장 실패:", e.message);
  }
}

function get(key) {
  const keys = key.split(".");
  if (keys.some((k) => DANGEROUS_KEYS.has(k))) return null;
  let val = data;
  for (const k of keys) {
    if (val == null || typeof val !== "object") return null;
    if (!Object.prototype.hasOwnProperty.call(val, k)) return null;
    val = val[k];
  }
  return val ?? null;
}

function set(key, value) {
  const keys = key.split(".");
  if (keys.some((k) => DANGEROUS_KEYS.has(k))) return;
  if (!ALLOWED_TOP_KEYS.has(keys[0])) return;

  let obj = data;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!Object.prototype.hasOwnProperty.call(obj, keys[i]) || typeof obj[keys[i]] !== "object") {
      obj[keys[i]] = {};
    }
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
  save();
}

load();

module.exports = { get, set, load, save };
