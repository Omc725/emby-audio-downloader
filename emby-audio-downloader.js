#!/usr/bin/env node

/**
 * Emby Media Stream Downloader (CLI)
 * 
 * Emby sunucusundan dönüştürme (transcoding) yapmadan
 * doğrudan orijinal ses, altyazı ve video dosyalarını indiren terminal aracı.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { spawn, execSync } = require("child_process");

// ==========================================
// RENK VE BİÇİMLENDİRME SABİTLERİ (ANSI)
// ==========================================
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  underline: "\x1b[4m",
  
  // Renkler
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  
  // Parlak renkler
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m"
};

// ==========================================
// DİL VE CODEC EŞLEŞTİRMELERİ
// ==========================================
const LANG_NAMES = {
  tur: "Türkçe",
  tr: "Türkçe",
  eng: "İngilizce",
  en: "İngilizce",
  fre: "Fransızca",
  fra: "Fransızca",
  fr: "Fransızca",
  ger: "Almanca",
  deu: "Almanca",
  de: "Almanca",
  spa: "İspanyolca",
  es: "İspanyolca",
  ita: "İtalyanca",
  it: "İtalyanca",
  rus: "Rusça",
  ru: "Rusça",
  jpn: "Japonca",
  ja: "Japonca",
  kor: "Korece",
  ko: "Korece",
  chi: "Çince",
  zho: "Çince",
  zh: "Çince",
  ara: "Arapça",
  ar: "Arapça",
  por: "Portekizce",
  pt: "Portekizce",
  dut: "Felemenkçe",
  nld: "Felemenkçe",
  nl: "Felemenkçe",
  pol: "Lehçe",
  pl: "Lehçe",
  swe: "İsveççe",
  sv: "İsveççe",
  hin: "Hintçe",
  hi: "Hintçe",
  und: "Bilinmeyen Dil"
};

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

// ==========================================
// YAPILANDIRMA DİZİNİ VE YOLU
// ==========================================
const CONFIG_DIR = path.join(os.homedir(), ".config", "emby-audio-downloader");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const QUEUE_FILE = path.join(CONFIG_DIR, "queue.json");

function ensureConfigDir() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  } catch (e) {}
}

function loadConfig() {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (e) {}
  return { savedServers: [] };
}

function saveConfig(config) {
  ensureConfigDir();
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
  } catch (e) {}
}

// ==========================================
// YARDIMCI GİRİŞ VE FORMAT FONKSİYONLARI
// ==========================================
let globalRl = null;

function getReadLine() {
  if (!globalRl) {
    globalRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return globalRl;
}

function ask(questionText) {
  return new Promise((resolve) => {
    const rl = getReadLine();
    rl.question(questionText, (answer) => {
      resolve(answer.trim());
    });
  });
}

function askPassword(questionText) {
  return new Promise((resolve) => {
    if (globalRl) {
      globalRl.close();
      globalRl = null;
    }

    process.stdout.write(questionText);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");

    let password = "";
    const onData = (char) => {
      if (char === "\n" || char === "\r" || char === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(password.trim());
      } else if (char === "\u0003") {
        stdin.setRawMode(false);
        stdin.pause();
        process.exit();
      } else if (char === "\u0008" || char === "\x7f") {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        password += char;
        process.stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

function clearScreen() {
  process.stdout.write("\x1Bc");
}

function printHeader(title) {
  console.log(`\n${C.bold}${C.cyan}======================================================================${C.reset}`);
  console.log(`${C.bold}${C.brightWhite}  ${title}${C.reset}`);
  console.log(`${C.bold}${C.cyan}======================================================================${C.reset}\n`);
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").trim();
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getAudioExtension(codec) {
  if (!codec) return "mka";
  const c = codec.toLowerCase();
  if (c.includes("eac3") || c.includes("ddp") || c.includes("ec-3")) return "eac3";
  if (c.includes("ac3") || c.includes("dolby digital")) return "ac3";
  if (c.includes("dts")) return "dts";
  if (c.includes("aac")) return "m4a";
  if (c.includes("mp3")) return "mp3";
  if (c.includes("flac")) return "flac";
  if (c.includes("opus")) return "opus";
  if (c.includes("vorbis") || c.includes("ogg")) return "ogg";
  if (c.startsWith("pcm")) return "wav";
  if (c === "truehd" || c === "thd") return "mka";
  return "mka";
}

function parseSelectionIndices(input, max) {
  const str = (input || "").trim().toUpperCase();
  if (str === "T" || str === "TÜM" || str === "TUM" || str === "HEPSI" || str === "H") {
    return Array.from({ length: max }, (_, i) => i);
  }
  const result = new Set();
  const parts = str.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes("-")) {
      const [startStr, endStr] = trimmed.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const minVal = Math.min(start, end);
        const maxVal = Math.max(start, end);
        for (let i = minVal; i <= maxVal; i++) {
          if (i >= 1 && i <= max) {
            result.add(i - 1);
          }
        }
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= max) {
        result.add(num - 1);
      }
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}

// ==========================================
// EMBY API İSTEMCİSİ
// ==========================================
class EmbyClient {
  constructor(serverUrl, port, username, token = null, userId = null, serverName = "", prefix = "") {
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.port = port;
    this.username = username;
    this.token = token;
    this.userId = userId;
    this.serverName = serverName;
    this.prefix = prefix || "";
  }

  getHeaders() {
    const headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Emby-Authorization": 'MediaBrowser Client="EmbyDownloader", Device="Terminal", DeviceId="emby-dl-cli", Version="1.1.0"'
    };
    if (this.token) {
      headers["X-Emby-Token"] = this.token;
      headers["X-MediaBrowser-Token"] = this.token;
      headers["Authorization"] = `MediaBrowser Token="${this.token}"`;
    }
    return headers;
  }

  async authenticate(password) {
    const endpoints = [
      `${this.serverUrl}/emby/Users/AuthenticateByName`,
      `${this.serverUrl}/Users/AuthenticateByName`
    ];

    let lastError = null;
    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: this.getHeaders(),
          body: JSON.stringify({
            Username: this.username,
            Pw: password || ""
          })
        });

        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
          continue;
        }

        const data = await res.json();
        if (data && data.AccessToken && data.User && data.User.Id) {
          this.token = data.AccessToken;
          this.userId = data.User.Id;
          this.serverName = data.ServerName || "Emby Server";
          this.prefix = url.includes("/emby/") ? "/emby" : "";
          return true;
        }
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error("Giriş başarısız. Kullanıcı adı veya şifre hatalı olabilir.");
  }

  async testConnection() {
    if (!this.token || !this.userId) return false;
    const testPrefixes = this.prefix ? [this.prefix, this.prefix === "/emby" ? "" : "/emby"] : ["/emby", ""];
    for (const p of testPrefixes) {
      try {
        const url = `${this.serverUrl}${p}/Users/${this.userId}/Items?Limit=1&api_key=${this.token}`;
        const res = await fetch(url, { headers: this.getHeaders() });
        if (res.ok) {
          this.prefix = p;
          return true;
        }
      } catch (e) {}
    }
    return false;
  }

  async searchByName(rawQuery) {
    const results = [];
    const seenIds = new Set();

    // 1. Düz sorgu ile Movie ve Series araması
    const searchUrl = `${this.serverUrl}${this.prefix}/Users/${this.userId}/Items?SearchTerm=${encodeURIComponent(rawQuery)}&IncludeItemTypes=Movie,Series&Recursive=true&api_key=${this.token}`;
    try {
      const res = await fetch(searchUrl, { headers: this.getHeaders() });
      if (res.ok) {
        const data = await res.json();
        (data.Items || []).forEach(item => {
          if (!seenIds.has(item.Id)) {
            seenIds.add(item.Id);
            results.push(item);
          }
        });
      }
    } catch (e) {}

    // 2. Dosya adı temizleme
    const cleanedTitle = cleanFilenameToTitle(rawQuery);
    if (cleanedTitle && cleanedTitle.toLowerCase() !== rawQuery.toLowerCase()) {
      const cleanSearchUrl = `${this.serverUrl}${this.prefix}/Users/${this.userId}/Items?SearchTerm=${encodeURIComponent(cleanedTitle)}&IncludeItemTypes=Movie,Series&Recursive=true&api_key=${this.token}`;
      try {
        const res = await fetch(cleanSearchUrl, { headers: this.getHeaders() });
        if (res.ok) {
          const data = await res.json();
          (data.Items || []).forEach(item => {
            if (!seenIds.has(item.Id)) {
              seenIds.add(item.Id);
              results.push(item);
            }
          });
        }
      } catch (e) {}
    }

    // 3. Bölüm adı veya eşleşmeyen dosyalar için Episode arama
    if (results.length === 0) {
      try {
        const anyUrl = `${this.serverUrl}${this.prefix}/Users/${this.userId}/Items?SearchTerm=${encodeURIComponent(rawQuery)}&Recursive=true&Limit=10&api_key=${this.token}`;
        const res = await fetch(anyUrl, { headers: this.getHeaders() });
        if (res.ok) {
          const data = await res.json();
          for (const item of (data.Items || [])) {
            if (item.Type === "Episode" && item.SeriesId && !seenIds.has(item.SeriesId)) {
              const sRes = await fetch(`${this.serverUrl}${this.prefix}/Users/${this.userId}/Items/${item.SeriesId}?api_key=${this.token}`, { headers: this.getHeaders() });
              if (sRes.ok) {
                const sData = await sRes.json();
                seenIds.add(sData.Id);
                results.push(sData);
              }
            } else if ((item.Type === "Movie" || item.Type === "Series") && !seenIds.has(item.Id)) {
              seenIds.add(item.Id);
              results.push(item);
            }
          }
        }
      } catch (e) {}
    }

    return results;
  }

  async searchById(idInput) {
    const raw = idInput.trim();
    let isImdb = false;
    let cleanId = raw;

    if (/^tt\d+/i.test(raw)) {
      isImdb = true;
      cleanId = raw.toLowerCase();
    } else if (raw.toLowerCase().startsWith("imdb:")) {
      isImdb = true;
      cleanId = raw.slice(5).trim().toLowerCase();
    } else if (raw.toLowerCase().startsWith("tmdb:")) {
      isImdb = false;
      cleanId = raw.slice(5).trim();
    } else if (/^\d+$/.test(raw)) {
      isImdb = false;
      cleanId = raw;
    }

    const providerQueries = isImdb
      ? [`imdb.${cleanId},Imdb.${cleanId}`, `tmdb.${cleanId},Tmdb.${cleanId}`]
      : [`tmdb.${cleanId},Tmdb.${cleanId}`, `TheMovieDb.${cleanId}`];

    const results = [];
    const seenIds = new Set();

    for (const q of providerQueries) {
      const url = `${this.serverUrl}${this.prefix}/Users/${this.userId}/Items?AnyProviderIdEquals=${encodeURIComponent(q)}&IncludeItemTypes=Movie,Series&Recursive=true&api_key=${this.token}`;
      try {
        const res = await fetch(url, { headers: this.getHeaders() });
        if (res.ok) {
          const data = await res.json();
          (data.Items || []).forEach(item => {
            if (!seenIds.has(item.Id)) {
              seenIds.add(item.Id);
              results.push(item);
            }
          });
        }
      } catch (e) {}
    }

    if (results.length === 0) {
      try {
        const meta = await fetchTmdbMetadata(cleanId, isImdb);
        if (meta && meta.title) {
          const byName = await this.searchByName(meta.title);
          byName.forEach(item => {
            if (!seenIds.has(item.Id)) {
              seenIds.add(item.Id);
              results.push(item);
            }
          });
        }
      } catch (e) {}
    }

    return results;
  }

  async getItemDetails(itemId) {
    const url = `${this.serverUrl}${this.prefix}/Users/${this.userId}/Items/${itemId}?api_key=${this.token}`;
    const res = await fetch(url, { headers: this.getHeaders() });
    if (!res.ok) return null;
    return await res.json();
  }

  async getSeasons(seriesId) {
    const url = `${this.serverUrl}${this.prefix}/Shows/${seriesId}/Seasons?UserId=${this.userId}&api_key=${this.token}`;
    const res = await fetch(url, { headers: this.getHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.Items || [];
  }

  async getEpisodes(seriesId, seasonId) {
    const seasonQuery = seasonId ? `SeasonId=${encodeURIComponent(seasonId)}&` : "";
    const url = `${this.serverUrl}${this.prefix}/Shows/${seriesId}/Episodes?${seasonQuery}UserId=${this.userId}&Fields=MediaSources&api_key=${this.token}`;
    const res = await fetch(url, { headers: this.getHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.Items || [];
  }

  buildStreamUrl(itemId, source) {
    const container = (source.Container || "mkv").toLowerCase();
    return `${this.serverUrl}${this.prefix}/Videos/${itemId}/stream.${container}?static=true&MediaSourceId=${encodeURIComponent(source.Id)}&api_key=${encodeURIComponent(this.token)}`;
  }

  buildDirectAudioStreamUrl(itemId, source, audioStream) {
    return `${this.serverUrl}${this.prefix}/Audio/${itemId}/stream.mka?AudioStreamIndex=${encodeURIComponent(audioStream.Index)}&MediaSourceId=${encodeURIComponent(source.Id)}&api_key=${encodeURIComponent(this.token)}`;
  }
}

function cleanFilenameToTitle(filename) {
  let s = path.basename(filename);
  s = s.replace(/\.[a-zA-Z0-9]{2,4}$/, "");
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/\{[^}]*\}/g, " ");
  const patterns = [
    /\b(2160p|1080p|1080i|720p|576p|480p|360p|4k|uhd|remux|bluray|blu-ray|web-dl|webrip|hdtv|dvdrip|brrip)\b/gi,
    /\b(x264|x265|h264|h265|hevc|avc|hdr|hdr10|dv|dolby\s*vision|truehd|atmos|dts|dts-hd|ac3|eac3|aac|mp3|flac)\b/gi,
    /\b(s\d{1,2}e\d{1,2}|\d{1,2}x\d{1,2})\b/gi,
    /\b(filmbol|filmbolseries|netflix|amazon|disney|apple|hbo)\b/gi,
    /#\d+/g
  ];
  for (const p of patterns) {
    s = s.replace(p, " ");
  }
  s = s.replace(/[._\-+]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

async function fetchTmdbMetadata(cleanId, isImdb) {
  try {
    if (isImdb) {
      const url = `https://api.themoviedb.org/3/find/${cleanId}?external_source=imdb_id&api_key=${TMDB_API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const match = (data.movie_results || [])[0] || (data.tv_results || [])[0];
      if (!match) return null;
      return {
        title: match.title || match.name,
        year: (match.release_date || match.first_air_date || "").split("-")[0]
      };
    } else if (/^\d+$/.test(cleanId)) {
      const url = `https://api.themoviedb.org/3/movie/${cleanId}?api_key=${TMDB_API_KEY}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        return {
          title: data.title || data.name,
          year: (data.release_date || "").split("-")[0]
        };
      }
      const tvUrl = `https://api.themoviedb.org/3/tv/${cleanId}?api_key=${TMDB_API_KEY}`;
      const tvRes = await fetch(tvUrl);
      if (tvRes.ok) {
        const data = await tvRes.json();
        return {
          title: data.name,
          year: (data.first_air_date || "").split("-")[0]
        };
      }
    }
  } catch (e) {}
  return null;
}

// ==========================================
// SES İNDİRME MOTORU (FFMPEG STREAM COPY)
// ==========================================
function downloadAudioStream(directAudioUrl, fallbackVideoUrl, audioStream, outputPath, totalDurationSeconds = 0) {
  return new Promise(async (resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const expectedTotalBytes = (audioStream && audioStream.BitRate && totalDurationSeconds > 0)
      ? Math.round((audioStream.BitRate / 8) * totalDurationSeconds)
      : 0;

    const runFfmpeg = (inputUrl, mapArg) => {
      return new Promise((res, rej) => {
        const args = [
          "-y",
          "-hide_banner",
          "-loglevel", "info",
          "-stats",
          "-reconnect", "1",
          "-reconnect_at_eof", "1",
          "-reconnect_streamed", "1",
          "-reconnect_on_network_error", "1",
          "-reconnect_delay_max", "15",
          "-i", inputUrl
        ];
        if (mapArg) {
          args.push("-map", mapArg);
        }
        args.push("-c:a", "copy", outputPath);

        const proc = spawn("ffmpeg", args);
        const startWall = Date.now();
        let lastPercent = 0;

        proc.stderr.on("data", (data) => {
          const text = data.toString("utf8");
          const sizeMatch = text.match(/size=\s*([0-9]+)\s*kB/i) || text.match(/size=\s*([0-9]+)\s*MB/i);
          const timeMatch = text.match(/time=\s*([0-9]{2}):([0-9]{2}):([0-9]{2}\.[0-9]+)/i) || text.match(/time=\s*([0-9:.]+)/i);
          const speedMatch = text.match(/speed=\s*([0-9.]+x)/i);

          if (timeMatch) {
            let currentSec = 0;
            if (timeMatch.length >= 4) {
              currentSec = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseFloat(timeMatch[3]);
            } else {
              const parts = timeMatch[1].split(":").map(Number);
              if (parts.length === 3) currentSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
            }

            let currentBytes = 0;
            if (sizeMatch) {
              const num = parseFloat(sizeMatch[1]);
              currentBytes = text.toLowerCase().includes("mb") ? num * 1024 * 1024 : num * 1024;
            }

            let percent = 0;
            if (totalDurationSeconds > 0 && currentSec > 0) {
              percent = Math.min(100, (currentSec / totalDurationSeconds) * 100);
              lastPercent = percent;
            } else if (lastPercent > 0) {
              percent = lastPercent;
            }

            const barWidth = 20;
            const filled = Math.min(barWidth, Math.round((percent / 100) * barWidth));
            const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

            let totalBytesEst = expectedTotalBytes;
            if (!totalBytesEst && percent > 0 && currentBytes > 0) {
              totalBytesEst = Math.round(currentBytes / (percent / 100));
            }
            const currentSizeStr = formatBytes(currentBytes);
            const totalSizeStr = totalBytesEst > 0 ? formatBytes(totalBytesEst) : "? MB";

            const elapsedWall = (Date.now() - startWall) / 1000;
            let mbps = "";
            if (elapsedWall > 0.5 && currentBytes > 0) {
              mbps = ` (${formatBytes(currentBytes / elapsedWall)}/s)`;
            }

            let etaStr = "";
            if (percent > 1 && percent < 100 && elapsedWall > 1) {
              const remainSec = Math.max(0, Math.round((elapsedWall / (percent / 100)) - elapsedWall));
              const m = Math.floor(remainSec / 60);
              const s = remainSec % 60;
              etaStr = ` | ${C.brightCyan}Kalan:${C.reset} ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
            }

            const speed = speedMatch ? speedMatch[1] : "";
            const status = `\r${C.cyan}[İndiriliyor]${C.reset} [${C.green}${bar}${C.reset}] ${C.brightGreen}${percent.toFixed(1).padStart(5)}%${C.reset} | ${C.brightWhite}${currentSizeStr} / ${totalSizeStr}${C.reset} | ${C.brightYellow}Hız: ${speed}${mbps}${C.reset}${etaStr}   `;
            process.stdout.write(status);
          }
        });

        proc.on("close", (code) => {
          process.stdout.write("\r" + " ".repeat(110) + "\r");
          if (code === 0) {
            let finalSize = 0;
            try {
              finalSize = fs.statSync(outputPath).size;
            } catch (e) {}
            res({
              path: outputPath,
              size: finalSize,
              formattedSize: formatBytes(finalSize)
            });
          } else {
            rej(new Error(`ffmpeg çıkış kodu: ${code}`));
          }
        });

        proc.on("error", rej);
      });
    };

    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (attempt > 1) {
        console.log(`\n${C.brightYellow}[UYARI] Bağlantı kesildi, 3 saniye sonra otomatik yeniden bağlanılıyor... (Deneme ${attempt}/${maxRetries})${C.reset}`);
        await new Promise(r => setTimeout(r, 3000));
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(e) {}
      }

      // 1. Strateji: Doğrudan yüksek hızlı Ses Akışı (stream.mka)
      try {
        if (directAudioUrl) {
          const result = await runFfmpeg(directAudioUrl, "0:a:0");
          if (result && result.size > 1024) {
            return resolve(result);
          }
        }
      } catch (directErr) {
        lastError = directErr;
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) {}
      }

      // 2. Strateji (Yedek): Statik video kapsayıcısından stream copy
      try {
        const streamIdx = audioStream?.Index !== undefined ? audioStream.Index : audioStream;
        const fallbackResult = await runFfmpeg(fallbackVideoUrl, `0:${streamIdx}`);
        if (fallbackResult && fallbackResult.size > 1024) {
          return resolve(fallbackResult);
        }
      } catch (fallbackErr) {
        lastError = fallbackErr;
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) {}
      }
    }

    reject(lastError || new Error("İndirme bağlantı hatası nedeniyle tamamlanamadı."));
  });
}

// ==========================================
// ALTYAZI İNDİRME FONKSİYONU
// ==========================================
async function downloadSubtitle(client, itemId, sourceId, subtitleStream, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const ext = subtitleStream.Codec === "ass" ? "ass" : (subtitleStream.Codec === "vtt" ? "vtt" : "srt");
  const subIndex = subtitleStream.Index;
  const subUrl = `${client.serverUrl}${client.prefix}/Videos/${itemId}/${sourceId}/Subtitles/${subIndex}/Stream.${ext}?api_key=${client.token}`;

  let res = await fetch(subUrl, { headers: client.getHeaders() });
  if (!res.ok && ext !== "srt") {
    const fallbackUrl = `${client.serverUrl}${client.prefix}/Videos/${itemId}/${sourceId}/Subtitles/${subIndex}/Stream.srt?api_key=${client.token}`;
    res = await fetch(fallbackUrl, { headers: client.getHeaders() });
  }

  if (!res.ok) {
    throw new Error(`Altyazı indirilemedi (HTTP ${res.status}: ${res.statusText})`);
  }

  const text = await res.text();
  fs.writeFileSync(outputPath, text, "utf8");
  const size = Buffer.byteLength(text, "utf8");
  return {
    path: outputPath,
    size: size,
    formattedSize: formatBytes(size)
  };
}

// ==========================================
// TAM VİDEO İNDİRME MOTORU (HTTP RANGE + RESUME)
// ==========================================
async function downloadFullVideo(videoUrl, outputPath, expectedSize = 0) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const partPath = `${outputPath}.part`;
  const maxRetries = 5;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let existingBytes = 0;
    if (fs.existsSync(partPath)) {
      try {
        existingBytes = fs.statSync(partPath).size;
      } catch (e) {}
    }

    if (expectedSize > 0 && existingBytes >= expectedSize) {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      fs.renameSync(partPath, outputPath);
      return { path: outputPath, size: existingBytes, formattedSize: formatBytes(existingBytes) };
    }

    const headers = {};
    if (existingBytes > 0) {
      headers["Range"] = `bytes=${existingBytes}-`;
    }

    try {
      const res = await fetch(videoUrl, { headers });
      if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      let totalBytes = 0;
      let isAppend = false;

      if (res.status === 206) {
        isAppend = true;
        const cr = res.headers.get("content-range");
        if (cr) {
          const match = cr.match(/\/(\d+)$/);
          if (match) totalBytes = parseInt(match[1], 10);
        }
        if (!totalBytes && expectedSize > 0) totalBytes = expectedSize;
      } else {
        isAppend = false;
        existingBytes = 0;
        const cl = res.headers.get("content-length");
        if (cl) totalBytes = parseInt(cl, 10);
        else if (expectedSize > 0) totalBytes = expectedSize;
      }

      const fileStream = fs.createWriteStream(partPath, { flags: isAppend ? "a" : "w" });
      let downloadedBytes = existingBytes;
      const startWall = Date.now();
      let lastPrintTime = 0;

      for await (const chunk of res.body) {
        if (!fileStream.write(chunk)) {
          await new Promise(r => fileStream.once("drain", r));
        }
        downloadedBytes += chunk.length;

        const now = Date.now();
        if (now - lastPrintTime > 200) {
          lastPrintTime = now;
          let percent = 0;
          if (totalBytes > 0) {
            percent = Math.min(100, (downloadedBytes / totalBytes) * 100);
          }

          const barWidth = 20;
          const filled = Math.min(barWidth, Math.round((percent / 100) * barWidth));
          const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

          const currentSizeStr = formatBytes(downloadedBytes);
          const totalSizeStr = totalBytes > 0 ? formatBytes(totalBytes) : "? MB";

          const elapsedSec = (now - startWall) / 1000;
          const sessionBytes = downloadedBytes - existingBytes;
          const speedBps = elapsedSec > 0 ? sessionBytes / elapsedSec : 0;
          const speedStr = `${formatBytes(speedBps)}/s`;
          const mbpsStr = `${((speedBps * 8) / (1000 * 1000)).toFixed(1)} Mbps`;

          let etaStr = "";
          if (percent > 0 && percent < 100 && speedBps > 1000) {
            const remainBytes = totalBytes - downloadedBytes;
            const remainSec = Math.max(0, Math.round(remainBytes / speedBps));
            const m = Math.floor(remainSec / 60);
            const s = remainSec % 60;
            etaStr = ` | ${C.brightCyan}Kalan:${C.reset} ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
          }

          const status = `\r${C.cyan}[İndiriliyor]${C.reset} [${C.green}${bar}${C.reset}] ${C.brightGreen}${percent.toFixed(1).padStart(5)}%${C.reset} | ${C.brightWhite}${currentSizeStr} / ${totalSizeStr}${C.reset} | ${C.brightYellow}Hız: ${speedStr} (${mbpsStr})${C.reset}${etaStr}   `;
          process.stdout.write(status);
        }
      }

      await new Promise((resolveEnd, rejectEnd) => {
        fileStream.end((err) => {
          if (err) rejectEnd(err);
          else resolveEnd();
        });
      });

      process.stdout.write("\r" + " ".repeat(110) + "\r");

      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      fs.renameSync(partPath, outputPath);

      const finalSize = fs.statSync(outputPath).size;
      return { path: outputPath, size: finalSize, formattedSize: formatBytes(finalSize) };
    } catch (err) {
      process.stdout.write("\r" + " ".repeat(110) + "\r");
      if (attempt < maxRetries) {
        console.log(`\n${C.brightYellow}[UYARI] Video indirme kesintisi (${err.message}). 3 saniye içinde kaldığı yerden (${formatBytes(existingBytes)}) devam edilecek... (Deneme ${attempt}/${maxRetries})${C.reset}`);
        await new Promise(r => setTimeout(r, 3000));
      } else {
        throw new Error(`Video indirme ${maxRetries} deneme sonrasında tamamlanamadı: ${err.message}`);
      }
    }
  }
}

// ==========================================
// İNDİRME KUYRUĞU YÖNETİCİSİ (QUEUE MANAGER)
// ==========================================
class DownloadQueue {
  constructor() {
    this.items = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(QUEUE_FILE)) {
        const data = fs.readFileSync(QUEUE_FILE, "utf8");
        this.items = JSON.parse(data);
      }
    } catch (e) {
      this.items = [];
    }
  }

  save() {
    try {
      ensureConfigDir();
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(this.items, null, 2), "utf8");
    } catch (e) {}
  }

  add(task) {
    task.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    task.status = "pending";
    task.error = null;
    this.items.push(task);
    this.save();
    return task;
  }

  addAll(tasks) {
    for (const t of tasks) {
      t.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      t.status = "pending";
      t.error = null;
      this.items.push(t);
    }
    this.save();
  }

  remove(index) {
    if (index >= 0 && index < this.items.length) {
      this.items.splice(index, 1);
      this.save();
      return true;
    }
    return false;
  }

  clear() {
    this.items = [];
    this.save();
  }

  getPendingCount() {
    return this.items.filter(it => it.status === "pending").length;
  }

  async processQueue(client) {
    const pendingItems = this.items.filter(it => it.status === "pending");
    if (pendingItems.length === 0) {
      console.log(`\n${C.yellow}[BILGI] Kuyrukta bekleyen herhangi bir indirme görevi bulunmuyor.${C.reset}\n`);
      return;
    }

    printHeader(`İNDİRME KUYRUĞU ÇALIŞTIRILIYOR (${pendingItems.length} Görev)`);

    let completedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < pendingItems.length; i++) {
      const item = pendingItems[i];
      console.log(`\n${C.bold}${C.brightCyan}[${i + 1}/${pendingItems.length}] [${item.typeLabel}] ${item.name}${C.reset}`);
      console.log(`${C.dim}Kayıt Yolu: ${item.outputPath}${C.reset}`);

      item.status = "downloading";
      this.save();

      try {
        const startTime = Date.now();
        let result = null;

        if (item.type === "video") {
          const videoUrl = client.buildStreamUrl(item.itemId, { Id: item.sourceId, Container: item.container });
          result = await downloadFullVideo(videoUrl, item.outputPath, item.expectedSize);
        } else if (item.type === "audio") {
          const directAudioUrl = client.buildDirectAudioStreamUrl(item.itemId, { Id: item.sourceId }, item.audioStream);
          const fallbackVideoUrl = client.buildStreamUrl(item.itemId, { Id: item.sourceId, Container: item.container });
          result = await downloadAudioStream(directAudioUrl, fallbackVideoUrl, item.audioStream, item.outputPath, item.totalDurationSeconds);
        } else if (item.type === "subtitle") {
          result = await downloadSubtitle(client, item.itemId, item.sourceId, item.subtitleStream, item.outputPath);
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        item.status = "completed";
        item.error = null;
        completedCount++;
        this.save();

        console.log(`${C.green}[TAMAMLANDI]${C.reset} Dosya kaydedildi: ${result?.formattedSize || formatBytes(result?.size || 0)} (${elapsed} sn)`);
      } catch (err) {
        item.status = "error";
        item.error = err.message;
        errorCount++;
        this.save();

        console.log(`${C.red}[HATA] İndirme başarısız: ${err.message}${C.reset}`);
      }
    }

    printHeader("KUYRUK İŞLEMLERİ TAMAMLANDI");
    console.log(`İşlenen Görev: ${pendingItems.length} | Tamamlanan: ${C.green}${completedCount}${C.reset} | Hata: ${C.red}${errorCount}${C.reset}\n`);
  }
}

// ==========================================
// KULLANICI ETKİLEŞİM VE GİRİŞ ADIMLARI
// ==========================================
async function setupAuthentication() {
  const config = loadConfig();
  const savedServers = config.savedServers || [];

  if (savedServers.length > 0) {
    printHeader("EMBY SUNUCU BAĞLANTISI");
    console.log(`${C.bold}Kayıtlı Sunucular:${C.reset}`);
    savedServers.forEach((s, idx) => {
      console.log(`  ${C.green}[${idx + 1}]${C.reset} ${C.brightWhite}${s.serverUrl}:${s.port}${C.reset} (Kullanıcı: ${C.yellow}${s.username}${C.reset}) - ${s.serverName || "Emby"}`);
    });
    console.log(`  ${C.cyan}[N]${C.reset} Yeni Sunucu / Kullanıcı Bilgisi Gir`);
    console.log(`  ${C.red}[S]${C.reset} Kayıtlı Sunucuları Sil / Temizle`);
    console.log(`  ${C.dim}[0] Çıkış${C.reset}\n`);

    const choice = await ask(`${C.bold}Seçiminiz (Varsayılan 1, 0: Çıkış): ${C.reset}`);
    if (choice === "0") {
      console.log("Çıkılıyor...");
      process.exit(0);
    }

    if (choice.toLowerCase() === "s") {
      saveConfig({ savedServers: [] });
      console.log(`${C.green}[BILGI] Kayıtlı sunucular silindi.${C.reset}`);
      return await setupAuthentication();
    }

    if (choice.toLowerCase() !== "n") {
      const idx = (choice === "" ? 1 : parseInt(choice, 10)) - 1;
      const selected = savedServers[idx] || savedServers[0];
      if (selected) {
        console.log(`\n${C.cyan}Oturum doğrulanıyor: ${selected.serverUrl} (${selected.username})...${C.reset}`);
        const client = new EmbyClient(selected.serverUrl, selected.port, selected.username, selected.token, selected.userId, selected.serverName, selected.prefix || "");
        let valid = await client.testConnection();

        if (!valid && selected.password) {
          try {
            console.log(`${C.cyan}Kayıtlı bilgilerle oturum yenileniyor...${C.reset}`);
            await client.authenticate(selected.password);
            selected.token = client.token;
            selected.userId = client.userId;
            selected.prefix = client.prefix;
            saveConfig(config);
            valid = true;
          } catch (e) {}
        }

        if (valid) {
          console.log(`${C.green}[BILGI] Bağlantı başarılı.${C.reset}\n`);
          return client;
        } else {
          console.log(`${C.yellow}[UYARI] Kayıtlı oturumun süresi dolmuş, yeniden şifre gerekiyor.${C.reset}`);
          const pwd = await askPassword(`${C.bold}Şifre: ${C.reset}`);
          try {
            await client.authenticate(pwd);
            selected.token = client.token;
            selected.userId = client.userId;
            selected.password = pwd;
            selected.prefix = client.prefix;
            saveConfig(config);
            console.log(`${C.green}[BILGI] Giriş başarılı.${C.reset}\n`);
            return client;
          } catch (e) {
            console.log(`${C.red}[HATA] Giriş yapılamadı: ${e.message}${C.reset}\n`);
          }
        }
      }
    }
  }

  // Yeni sunucu bilgisi isteme
  printHeader("YENİ EMBY SUNUCUSU TANIMLAMA");
  let serverAddr = await ask(`${C.bold}Sunucu Adresi (Örn: https://emby.example.com, 0: Geri): ${C.reset}`);
  if (serverAddr === "0" || !serverAddr) {
    if (savedServers.length > 0) return await setupAuthentication();
    console.log(`${C.red}[HATA] Sunucu adresi boş bırakılamaz.${C.reset}\n`);
    return await setupAuthentication();
  }

  let defaultPort = serverAddr.startsWith("https://") ? "443" : "8096";
  try {
    const parsed = new URL(serverAddr.startsWith("http") ? serverAddr : `https://${serverAddr}`);
    if (parsed.port) defaultPort = parsed.port;
  } catch (e) {}

  let portInput = await ask(`${C.bold}Port (Varsayılan ${defaultPort}): ${C.reset}`);
  const port = portInput ? portInput : defaultPort;

  let finalUrl = serverAddr;
  if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
    finalUrl = (port === "443" ? "https://" : "http://") + finalUrl;
  }
  const urlObj = new URL(finalUrl);
  urlObj.port = port;
  finalUrl = urlObj.origin;

  let username = await ask(`${C.bold}Kullanıcı Adı: ${C.reset}`);
  let password = await askPassword(`${C.bold}Şifre: ${C.reset}`);

  console.log(`\n${C.cyan}Bağlanılıyor: ${finalUrl} (${username})...${C.reset}`);
  const client = new EmbyClient(finalUrl, port, username);

  try {
    await client.authenticate(password);
    console.log(`${C.green}[BILGI] Giriş başarılı. (Sunucu: ${client.serverName || "Emby"})${C.reset}\n`);

    const existing = config.savedServers.findIndex(s => s.serverUrl === client.serverUrl && s.username === client.username);
    const profile = {
      serverUrl: client.serverUrl,
      port: client.port,
      username: client.username,
      password: password,
      token: client.token,
      userId: client.userId,
      serverName: client.serverName,
      prefix: client.prefix,
      lastUsed: Date.now()
    };
    if (existing >= 0) {
      config.savedServers[existing] = profile;
    } else {
      config.savedServers.unshift(profile);
    }
    saveConfig(config);
    return client;
  } catch (err) {
    console.log(`${C.red}[HATA] Bağlantı hatası: ${err.message}${C.reset}\n`);
    const retry = await ask("Yeniden denemek ister misiniz? (E/h): ");
    if (retry.toLowerCase() === "h") {
      process.exit(1);
    }
    return await setupAuthentication();
  }
}

// ==========================================
// ANA ARAMA VE KUYRUK MENÜSÜ
// ==========================================
async function searchMenu(client, queue) {
  while (true) {
    const pendingCount = queue.getPendingCount();
    const queueBadge = pendingCount > 0 ? ` ${C.brightYellow}(${pendingCount} Bekleyen Görev)${C.reset}` : "";

    printHeader(`EMBY MEDYA İNDİRİCİ - ${client.serverUrl} (${client.username})`);
    console.log(`${C.bold}İşlemler:${C.reset}`);
    console.log(`  ${C.green}[1]${C.reset} İsim ile Arama ${C.dim}(Film / Dizi Adı veya Dosya Adı)${C.reset}`);
    console.log(`  ${C.green}[2]${C.reset} TMDB veya IMDb ID ile Arama ${C.dim}(Örn: tt0133093 / 603)${C.reset}`);
    console.log(`  ${C.brightCyan}[K]${C.reset} İndirme Kuyruğu${queueBadge}`);
    console.log(`  ${C.yellow}[3]${C.reset} Sunucu / Kullanıcı Değiştir`);
    console.log(`  ${C.dim}[0] Çıkış${C.reset}\n`);

    const choice = await ask(`${C.bold}Seçiminiz: ${C.reset}`);

    if (choice === "0" || choice === "") {
      console.log("Program sonlandırıldı.");
      process.exit(0);
    } else if (choice.toUpperCase() === "K") {
      await queueMenu(client, queue);
    } else if (choice === "3") {
      client = await setupAuthentication();
    } else if (choice === "1") {
      const q = await ask(`\n${C.bold}Aranacak Film/Dizi Adı veya Dosya Adı (0: İptal): ${C.reset}`);
      if (!q || q === "0") continue;
      console.log(`\n${C.cyan}Aranıyor: "${q}"...${C.reset}`);
      const items = await client.searchByName(q);
      await handleSearchResults(client, items, queue);
    } else if (choice === "2") {
      const id = await ask(`\n${C.bold}TMDB veya IMDb ID (Örn: tt0133093 / 603, 0: İptal): ${C.reset}`);
      if (!id || id === "0") continue;
      console.log(`\n${C.cyan}ID sorgulanıyor: "${id}"...${C.reset}`);
      const items = await client.searchById(id);
      await handleSearchResults(client, items, queue);
    }
  }
}

async function queueMenu(client, queue) {
  while (true) {
    printHeader(`İNDİRME KUYRUĞU (${queue.items.length} Öğe)`);
    if (queue.items.length === 0) {
      console.log(`${C.dim}Kuyruk boş.${C.reset}\n`);
      console.log(`  ${C.dim}[0] Ana Menüye Dön${C.reset}\n`);
      await ask(`${C.bold}Seçiminiz: ${C.reset}`);
      return;
    }

    queue.items.forEach((it, idx) => {
      let statusBadge = `${C.yellow}[Bekliyor]${C.reset}`;
      if (it.status === "completed") statusBadge = `${C.green}[Tamamlandı]${C.reset}`;
      else if (it.status === "downloading") statusBadge = `${C.cyan}[İndiriliyor]${C.reset}`;
      else if (it.status === "error") statusBadge = `${C.red}[Hata: ${it.error || "Bilinmiyor"}]${C.reset}`;

      const typeBadge = `${C.brightMagenta}[${it.typeLabel}]${C.reset}`;
      console.log(`  ${C.bold}[${idx + 1}]${C.reset} ${typeBadge} ${it.name} ${statusBadge}`);
    });

    console.log(`\n  ${C.brightGreen}[B]${C.reset} ${C.bold}Kuyruğu Başlat (Bekleyenleri İndir)${C.reset}`);
    console.log(`  ${C.brightRed}[T]${C.reset} Kuyruğu Temizle`);
    console.log(`  ${C.brightYellow}[S]${C.reset} Kuyruktan Öğe Sil`);
    console.log(`  ${C.dim}[0] Ana Menüye Dön${C.reset}\n`);

    const choice = await ask(`${C.bold}Seçiminiz (0: Geri): ${C.reset}`);
    if (choice === "0" || !choice) return;

    if (choice.toUpperCase() === "B") {
      await queue.processQueue(client);
      await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
    } else if (choice.toUpperCase() === "T") {
      const confirm = await ask(`${C.bold}Kuyruktaki tüm öğeler temizlensin mi? (E/h): ${C.reset}`);
      if (confirm.toUpperCase() === "E" || confirm === "") {
        queue.clear();
        console.log(`${C.green}[BILGI] Kuyruk temizlendi.${C.reset}`);
      }
    } else if (choice.toUpperCase() === "S") {
      const delIdx = await ask(`${C.bold}Silinecek öğe numarası (1-${queue.items.length}, 0: İptal): ${C.reset}`);
      if (delIdx === "0" || !delIdx) continue;
      const num = parseInt(delIdx, 10) - 1;
      if (queue.remove(num)) {
        console.log(`${C.green}[BILGI] Öğe kuyruktan silindi.${C.reset}`);
      } else {
        console.log(`${C.red}[HATA] Geçersiz öğe numarası.${C.reset}`);
      }
    }
  }
}

// ==========================================
// ARAMA SONUÇLARI DÖNGÜSÜ
// ==========================================
async function handleSearchResults(client, items, queue) {
  if (!items || items.length === 0) {
    console.log(`\n${C.yellow}[UYARI] Aradığınız kriterlere uygun Film veya Dizi bulunamadı.${C.reset}\n`);
    await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
    return;
  }

  while (true) {
    printHeader(`ARAMA SONUÇLARI (${items.length} Sonuç Bulundu)`);
    items.forEach((item, idx) => {
      const isTv = item.Type === "Series";
      const typeBadge = isTv ? `${C.brightMagenta}[Dizi]${C.reset}` : `${C.brightBlue}[Film]${C.reset}`;
      const yearStr = item.ProductionYear ? `(${item.ProductionYear}) ` : "";
      console.log(`  ${C.green}[${idx + 1}]${C.reset} ${C.bold}${item.Name}${C.reset} ${yearStr}${typeBadge}`);
    });
    console.log(`  ${C.dim}[0] Ana Menüye Dön${C.reset}\n`);

    const choice = await ask(`${C.bold}Lütfen bir içerik seçin (1-${items.length}, 0: Geri): ${C.reset}`);
    if (choice === "0" || !choice) {
      return; // 1 adım geri: Ana Menü
    }

    const selIdx = parseInt(choice, 10) - 1;
    const selectedItem = items[selIdx];
    if (!selectedItem) {
      console.log(`${C.red}[HATA] Geçersiz seçim.${C.reset}`);
      await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
      continue;
    }

    if (selectedItem.Type === "Series") {
      await handleSeriesFlow(client, selectedItem, queue);
    } else {
      await handleMovieFlow(client, selectedItem, queue);
    }
  }
}

// ==========================================
// DİZİ AKIŞI VE BÖLÜM GEZİNTİSİ
// ==========================================
async function handleSeriesFlow(client, seriesItem, queue) {
  console.log(`\n${C.cyan}Dizi sezonları yükleniyor: "${seriesItem.Name}"...${C.reset}`);
  const seasons = await client.getSeasons(seriesItem.Id);

  if (!seasons || seasons.length === 0) {
    console.log(`${C.yellow}[UYARI] Bu dizi için sezon bulunamadı.${C.reset}`);
    await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
    return;
  }

  while (true) {
    printHeader(`SEZON SEÇİMİ - ${seriesItem.Name}`);
    seasons.forEach((season, idx) => {
      console.log(`  ${C.green}[${idx + 1}]${C.reset} ${C.bold}${season.Name}${C.reset}`);
    });
    console.log(`  ${C.dim}[0] Arama Sonuçlarına Dön${C.reset}\n`);

    const sChoice = await ask(`${C.bold}Sezon seçin (1-${seasons.length}, 0: Geri): ${C.reset}`);
    if (sChoice === "0" || !sChoice) {
      return; // 1 adım geri: Arama Sonuçları
    }

    const season = seasons[parseInt(sChoice, 10) - 1];
    if (!season) {
      console.log(`${C.red}[HATA] Geçersiz sezon seçimi.${C.reset}`);
      await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
      continue;
    }

    await handleEpisodeSelectionFlow(client, seriesItem, season, queue);
  }
}

async function handleEpisodeSelectionFlow(client, seriesItem, season, queue) {
  console.log(`\n${C.cyan}Bölümler yükleniyor: ${season.Name}...${C.reset}`);
  const episodes = await client.getEpisodes(seriesItem.Id, season.Id);

  if (!episodes || episodes.length === 0) {
    console.log(`${C.yellow}[UYARI] Bu sezonda bölüm bulunamadı.${C.reset}`);
    await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
    return;
  }

  while (true) {
    printHeader(`BÖLÜM SEÇİMİ - ${seriesItem.Name} (${season.Name})`);
    episodes.forEach((ep, idx) => {
      const epNum = ep.IndexNumber !== undefined ? `Bölüm ${ep.IndexNumber}: ` : "";
      console.log(`  ${C.green}[${idx + 1}]${C.reset} ${C.bold}${epNum}${ep.Name}${C.reset}`);
    });
    console.log(`  ${C.brightCyan}[T]${C.reset} ${C.bold}Tüm Sezonu Seç (${episodes.length} Bölüm)${C.reset}`);
    console.log(`  ${C.dim}[0] Sezon Seçimine Dön${C.reset}\n`);

    const epChoice = await ask(`${C.bold}Bölüm seçin (Tek: 1, Aralık: 1-5, Liste: 1,3,4, Tüm: T, 0: Geri): ${C.reset}`);
    if (epChoice === "0" || !epChoice) {
      return; // 1 adım geri: Sezon Seçimi
    }

    const selectedIndices = parseSelectionIndices(epChoice, episodes.length);
    if (selectedIndices.length === 0) {
      console.log(`${C.red}[HATA] Geçersiz bölüm seçimi.${C.reset}`);
      await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
      continue;
    }

    if (selectedIndices.length === 1) {
      const episode = episodes[selectedIndices[0]];
      await handleItemVersionsAndDownload(client, episode.Id, {
        isTv: true,
        seriesName: seriesItem.Name,
        seasonIndex: season.IndexNumber !== undefined ? season.IndexNumber : 1,
        episodeIndex: episode.IndexNumber !== undefined ? episode.IndexNumber : 1,
        episodeName: episode.Name || `Bölüm ${episode.IndexNumber}`
      }, queue);
    } else {
      const selectedEpisodes = selectedIndices.map(i => episodes[i]);
      await handleBatchEpisodesFlow(client, seriesItem, season, selectedEpisodes, queue);
    }
  }
}

// ==========================================
// TOPLU BÖLÜM İNDİRME AKIŞI
// ==========================================
async function handleBatchEpisodesFlow(client, seriesItem, season, selectedEpisodes, queue) {
  const downloadDir = path.resolve(process.cwd(), "downloads");
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  while (true) {
    printHeader(`TOPLU BÖLÜM İNDİRME - ${seriesItem.Name} (${season.Name})`);
    console.log(`Seçilen Bölüm Sayısı: ${C.bold}${selectedEpisodes.length}${C.reset}\n`);
    console.log(`  ${C.green}[1]${C.reset} Video Dosyalarını İndir (Tüm Dosya)`);
    console.log(`  ${C.green}[2]${C.reset} Belirli Bir Dildeki Ses Dosyalarını İndir`);
    console.log(`  ${C.green}[3]${C.reset} Belirli Bir Dildeki Altyazı Dosyalarını İndir`);
    console.log(`  ${C.dim}[0] Bölüm Seçimine Dön${C.reset}\n`);

    const batchType = await ask(`${C.bold}Toplu İndirme Türü Seçin (1-3, 0: Geri): ${C.reset}`);
    if (batchType === "0" || !batchType) {
      return; // 1 adım geri: Bölüm seçimi
    }

    let tasks = [];

    if (batchType === "1") {
      // Toplu Video
      for (const ep of selectedEpisodes) {
        let mediaSources = ep.MediaSources;
        if (!mediaSources || mediaSources.length === 0) {
          const fullEp = await client.getItemDetails(ep.Id);
          mediaSources = fullEp?.MediaSources || [];
        }
        if (!mediaSources || mediaSources.length === 0) continue;

        const source = mediaSources[0];
        const container = (source.Container || "mkv").toLowerCase();
        const sNum = String(season.IndexNumber !== undefined ? season.IndexNumber : 1).padStart(2, "0");
        const eNum = String(ep.IndexNumber !== undefined ? ep.IndexNumber : 1).padStart(2, "0");
        const baseFilename = `${seriesItem.Name} - S${sNum}E${eNum} - ${ep.Name || "Bolum"}.${container}`;
        const safeFilename = sanitizeFilename(baseFilename);
        const targetPath = path.join(downloadDir, safeFilename);

        tasks.push({
          type: "video",
          typeLabel: "Video",
          name: `${seriesItem.Name} S${sNum}E${eNum} (${safeFilename})`,
          itemId: ep.Id,
          sourceId: source.Id,
          container: container,
          outputPath: targetPath,
          expectedSize: source.Size || 0
        });
      }
    } else if (batchType === "2") {
      // Toplu Ses - Alt Menü
      let audioSubMenuDone = false;
      while (!audioSubMenuDone) {
        printHeader("SES DİLİ SEÇİMİ (TOPLU)");
        console.log(`  ${C.green}[1]${C.reset} Türkçe Ses`);
        console.log(`  ${C.green}[2]${C.reset} Orijinal / İngilizce Ses`);
        console.log(`  ${C.green}[3]${C.reset} Varsayılan (Default) Ses Kanalı`);
        console.log(`  ${C.green}[4]${C.reset} Tüm Ses Kanalları`);
        console.log(`  ${C.dim}[0] Toplu İndirme Menüsüne Dön${C.reset}\n`);

        const langChoice = await ask(`${C.bold}Seçiminiz (1-4, 0: Geri): ${C.reset}`);
        if (langChoice === "0" || !langChoice) {
          audioSubMenuDone = true;
          break; // 1 adım geri: Toplu İndirme Menüsü
        }

        tasks = [];
        for (const ep of selectedEpisodes) {
          let mediaSources = ep.MediaSources;
          if (!mediaSources || mediaSources.length === 0) {
            const fullEp = await client.getItemDetails(ep.Id);
            mediaSources = fullEp?.MediaSources || [];
          }
          if (!mediaSources || mediaSources.length === 0) continue;

          const source = mediaSources[0];
          const audioStreams = (source.MediaStreams || []).filter(st => st.Type === "Audio");
          if (audioStreams.length === 0) continue;

          let targetAudios = [];
          if (langChoice === "1") {
            targetAudios = audioStreams.filter(a => (a.Language || "").toLowerCase().startsWith("tr") || (a.Language || "").toLowerCase() === "tur");
          } else if (langChoice === "2") {
            targetAudios = audioStreams.filter(a => (a.Language || "").toLowerCase().startsWith("en") || (a.Language || "").toLowerCase() === "eng");
          } else if (langChoice === "3") {
            const def = audioStreams.find(a => a.IsDefault) || audioStreams[0];
            if (def) targetAudios = [def];
          } else if (langChoice === "4") {
            targetAudios = audioStreams;
          }

          if (targetAudios.length === 0 && langChoice !== "4") {
            const fallback = audioStreams.find(a => a.IsDefault) || audioStreams[0];
            if (fallback) targetAudios = [fallback];
          }

          const sNum = String(season.IndexNumber !== undefined ? season.IndexNumber : 1).padStart(2, "0");
          const eNum = String(ep.IndexNumber !== undefined ? ep.IndexNumber : 1).padStart(2, "0");
          const totalDur = (source.RunTimeTicks || ep.RunTimeTicks) ? (source.RunTimeTicks || ep.RunTimeTicks) / 10000000 : 0;

          for (const audio of targetAudios) {
            const ext = getAudioExtension(audio.Codec);
            const langCode = (audio.Language || "und").toLowerCase();
            const langName = LANG_NAMES[langCode] || audio.Language || "Audio";
            const codecName = (audio.Codec || "audio").toUpperCase();
            const channels = audio.Channels === 8 ? "7.1" : (audio.Channels === 6 ? "5.1" : (audio.Channels === 2 ? "Stereo" : `${audio.Channels}ch`));
            const baseFilename = `${seriesItem.Name} - S${sNum}E${eNum} - ${ep.Name || "Bolum"} - [${langName} ${codecName} ${channels}].${ext}`;
            const safeFilename = sanitizeFilename(baseFilename);
            const targetPath = path.join(downloadDir, safeFilename);

            tasks.push({
              type: "audio",
              typeLabel: "Ses",
              name: `${seriesItem.Name} S${sNum}E${eNum} - [${langName}]`,
              itemId: ep.Id,
              sourceId: source.Id,
              container: (source.Container || "mkv").toLowerCase(),
              audioStream: audio,
              outputPath: targetPath,
              totalDurationSeconds: totalDur
            });
          }
        }
        audioSubMenuDone = true;
      }
      if (tasks.length === 0) continue;
    } else if (batchType === "3") {
      // Toplu Altyazı - Alt Menü
      let subSubMenuDone = false;
      while (!subSubMenuDone) {
        printHeader("ALTYAZI DİLİ SEÇİMİ (TOPLU)");
        console.log(`  ${C.green}[1]${C.reset} Türkçe Altyazı`);
        console.log(`  ${C.green}[2]${C.reset} İngilizce Altyazı`);
        console.log(`  ${C.green}[3]${C.reset} Tüm Altyazılar`);
        console.log(`  ${C.dim}[0] Toplu İndirme Menüsüne Dön${C.reset}\n`);

        const subChoice = await ask(`${C.bold}Seçiminiz (1-3, 0: Geri): ${C.reset}`);
        if (subChoice === "0" || !subChoice) {
          subSubMenuDone = true;
          break; // 1 adım geri: Toplu İndirme Menüsü
        }

        tasks = [];
        for (const ep of selectedEpisodes) {
          let mediaSources = ep.MediaSources;
          if (!mediaSources || mediaSources.length === 0) {
            const fullEp = await client.getItemDetails(ep.Id);
            mediaSources = fullEp?.MediaSources || [];
          }
          if (!mediaSources || mediaSources.length === 0) continue;

          const source = mediaSources[0];
          const subStreams = (source.MediaStreams || []).filter(st => st.Type === "Subtitle");
          if (subStreams.length === 0) continue;

          let targetSubs = [];
          if (subChoice === "1") {
            targetSubs = subStreams.filter(s => (s.Language || "").toLowerCase().startsWith("tr") || (s.Language || "").toLowerCase() === "tur");
          } else if (subChoice === "2") {
            targetSubs = subStreams.filter(s => (s.Language || "").toLowerCase().startsWith("en") || (s.Language || "").toLowerCase() === "eng");
          } else if (subChoice === "3") {
            targetSubs = subStreams;
          }

          const sNum = String(season.IndexNumber !== undefined ? season.IndexNumber : 1).padStart(2, "0");
          const eNum = String(ep.IndexNumber !== undefined ? ep.IndexNumber : 1).padStart(2, "0");

          for (const sub of targetSubs) {
            const subExt = sub.Codec === "ass" ? "ass" : (sub.Codec === "vtt" ? "vtt" : "srt");
            const langCode = (sub.Language || "und").toLowerCase();
            const langName = LANG_NAMES[langCode] || sub.Language || "Altyazı";
            const forcedTag = sub.IsForced ? " Forced" : "";
            const baseFilename = `${seriesItem.Name} - S${sNum}E${eNum} - ${ep.Name || "Bolum"} - [${langName}${forcedTag}].${subExt}`;
            const safeFilename = sanitizeFilename(baseFilename);
            const targetPath = path.join(downloadDir, safeFilename);

            tasks.push({
              type: "subtitle",
              typeLabel: "Altyazı",
              name: `${seriesItem.Name} S${sNum}E${eNum} - [${langName}${forcedTag}]`,
              itemId: ep.Id,
              sourceId: source.Id,
              subtitleStream: sub,
              outputPath: targetPath
            });
          }
        }
        subSubMenuDone = true;
      }
      if (tasks.length === 0) continue;
    }

    if (tasks.length === 0) {
      console.log(`\n${C.yellow}[UYARI] Seçilen kriterlere uygun indirilebilir öğe bulunamadı.${C.reset}\n`);
      await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
      continue;
    }

    const execResult = await promptExecutionChoice(tasks, queue, client);
    if (execResult === "BACK") {
      continue; // 1 adım geri: Toplu İndirme Menüsü
    }
    return; // Tamamlandı, Bölüm Seçimine dön
  }
}

async function handleMovieFlow(client, movieItem, queue) {
  await handleItemVersionsAndDownload(client, movieItem.Id, {
    isTv: false,
    title: movieItem.Name,
    year: movieItem.ProductionYear
  }, queue);
}

// ==========================================
// SÜRÜM SEÇİMİ VE İNDİRME AKIŞI
// ==========================================
async function handleItemVersionsAndDownload(client, itemId, meta, queue) {
  console.log(`\n${C.cyan}Medya kaynakları ve sürümler inceleniyor...${C.reset}`);
  const item = await client.getItemDetails(itemId);

  if (!item || !item.MediaSources || item.MediaSources.length === 0) {
    console.log(`${C.red}[HATA] Bu içerik için oynatılabilir medya kaynağı bulunamadı.${C.reset}`);
    await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
    return;
  }

  const sources = item.MediaSources;

  if (sources.length === 1) {
    const selectedSource = sources[0];
    const vName = selectedSource.Name || path.basename(selectedSource.Path || "Tek Sürüm");
    const container = (selectedSource.Container || "mkv").toUpperCase();
    const sizeStr = selectedSource.Size ? ` | ${formatBytes(selectedSource.Size)}` : "";
    
    printHeader("MEDYA SÜRÜMÜ");
    console.log(`Mevcut Sürüm:`);
    console.log(`  ${C.bold}${C.brightGreen}${vName}${C.reset} [${container}${sizeStr}]\n`);
    await handleDownloadTypesFlow(client, itemId, selectedSource, item, meta, queue);
    return;
  }

  while (true) {
    printHeader(`SÜRÜM SEÇİMİ (${sources.length} Sürüm Mevcut)`);
    sources.forEach((s, idx) => {
      const vName = s.Name || path.basename(s.Path || `Sürüm ${idx + 1}`);
      const container = (s.Container || "mkv").toUpperCase();
      const sizeStr = s.Size ? ` | ${formatBytes(s.Size)}` : "";
      
      const vStream = (s.MediaStreams || []).find(st => st.Type === "Video");
      const vCodec = vStream?.Codec ? ` | ${vStream.Codec.toUpperCase()}` : "";
      const vRes = vStream?.Height ? ` | ${vStream.Height}p` : "";

      console.log(`  ${C.green}[${idx + 1}]${C.reset} ${C.bold}${vName}${C.reset} ${C.dim}(${container}${sizeStr}${vCodec}${vRes})${C.reset}`);
    });
    console.log(`  ${C.dim}[0] Geri Dön${C.reset}\n`);

    const vChoice = await ask(`${C.bold}Lütfen sürüm seçin (1-${sources.length}, 0: Geri): ${C.reset}`);
    if (vChoice === "0" || !vChoice) {
      return; // 1 adım geri
    }

    const sIdx = parseInt(vChoice, 10) - 1;
    const selectedSource = sources[sIdx];
    if (!selectedSource) {
      console.log(`${C.red}[HATA] Geçersiz sürüm seçimi.${C.reset}`);
      await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
      continue;
    }

    const res = await handleDownloadTypesFlow(client, itemId, selectedSource, item, meta, queue);
    if (res === "DONE") {
      return;
    }
  }
}

// ==========================================
// İNDİRME TÜRÜ SEÇİM AKIŞI
// ==========================================
async function handleDownloadTypesFlow(client, itemId, selectedSource, item, meta, queue) {
  const audioStreams = (selectedSource.MediaStreams || []).filter(st => st.Type === "Audio");
  const subtitleStreams = (selectedSource.MediaStreams || []).filter(st => st.Type === "Subtitle");
  const container = (selectedSource.Container || "mkv").toLowerCase();
  const sizeStr = selectedSource.Size ? formatBytes(selectedSource.Size) : "";
  const totalDurationSeconds = (selectedSource.RunTimeTicks || item.RunTimeTicks)
    ? (selectedSource.RunTimeTicks || item.RunTimeTicks) / 10000000
    : 0;

  const downloadDir = path.resolve(process.cwd(), "downloads");
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  while (true) {
    printHeader("İNDİRME TÜRÜ SEÇİMİ");
    console.log(`Seçilen Sürüm: ${C.bold}${selectedSource.Name || "Varsayılan"}${C.reset} (${container.toUpperCase()}${sizeStr ? " | " + sizeStr : ""})\n`);
    console.log(`  ${C.green}[1]${C.reset} Sadece Ses İndir ${C.dim}(Dönüştürmesiz Stream Copy - ${audioStreams.length} Ses Parçası)${C.reset}`);
    console.log(`  ${C.green}[2]${C.reset} Sadece Altyazı İndir ${C.dim}(${subtitleStreams.length} Altyazı Mevcut)${C.reset}`);
    console.log(`  ${C.green}[3]${C.reset} Tüm Dosyayı (Video) İndir ${C.dim}(${sizeStr})${C.reset}`);
    console.log(`  ${C.brightCyan}[4]${C.reset} Tümünü İndir ${C.dim}(Video + Tüm Sesler + Tüm Altyazılar)${C.reset}`);
    console.log(`  ${C.dim}[0] Geri Dön${C.reset}\n`);

    const dlType = await ask(`${C.bold}Seçiminiz (1-4, 0: Geri): ${C.reset}`);
    if (dlType === "0" || !dlType) {
      return "BACK"; // 1 adım geri: Sürüm seçimi veya üst liste
    }

    if (dlType === "1") {
      // SADECE SES
      if (audioStreams.length === 0) {
        console.log(`\n${C.yellow}[UYARI] Bu sürümde ses akışı tespit edilemedi.${C.reset}`);
        await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
        continue;
      }

      while (true) {
        printHeader("SES PARÇASI SEÇİMİ (DÖNÜŞTÜRMESİZ)");
        audioStreams.forEach((a, idx) => {
          const langCode = (a.Language || "und").toLowerCase();
          const langName = LANG_NAMES[langCode] || a.Language || "Bilinmiyor";
          const codec = (a.Codec || "audio").toUpperCase();
          const channels = a.Channels === 8 ? "7.1" : (a.Channels === 6 ? "5.1" : (a.Channels === 2 ? "Stereo" : `${a.Channels || "?"} Kanal`));
          const bitRate = a.BitRate ? ` - ${(a.BitRate / 1000).toFixed(0)} kbps` : "";
          const title = a.DisplayTitle || a.Title || "";
          const hasDefaultInTitle = title.toLowerCase().includes("varsayılan") || title.toLowerCase().includes("default");
          const isDefault = (a.IsDefault && !hasDefaultInTitle) ? ` ${C.cyan}(Varsayılan)${C.reset}` : "";

          console.log(`  ${C.green}[${idx + 1}]${C.reset} ${C.brightYellow}[${langName}]${C.reset} ${C.bold}${codec} ${channels}${C.reset}${bitRate} - ${C.dim}${title}${C.reset}${isDefault}`);
        });
        console.log(`  ${C.brightCyan}[H]${C.reset} Tüm Ses Parçalarını İndir (Hepsi)`);
        console.log(`  ${C.dim}[0] İndirme Türü Seçimine Dön${C.reset}\n`);

        const aChoice = await ask(`${C.bold}Seçiminiz (Örn: 1 veya 1,2 veya H, 0: Geri): ${C.reset}`);
        if (aChoice === "0" || !aChoice) {
          break; // 1 adım geri: İndirme Türü Seçimi
        }

        let selectedAudios = [];
        if (aChoice.toUpperCase() === "H" || aChoice.toUpperCase() === "HEPSI") {
          selectedAudios = audioStreams;
        } else {
          const indices = aChoice.split(",").map(x => parseInt(x.trim(), 10) - 1);
          for (const i of indices) {
            if (audioStreams[i]) selectedAudios.push(audioStreams[i]);
          }
        }

        if (selectedAudios.length === 0) {
          console.log(`${C.red}[HATA] Geçerli bir ses seçimi yapılmadı.${C.reset}`);
          await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
          continue;
        }

        const tasks = [];
        for (const audio of selectedAudios) {
          const ext = getAudioExtension(audio.Codec);
          const langCode = (audio.Language || "und").toLowerCase();
          const langName = LANG_NAMES[langCode] || audio.Language || "Audio";
          const codecName = (audio.Codec || "audio").toUpperCase();
          const channels = audio.Channels === 8 ? "7.1" : (audio.Channels === 6 ? "5.1" : (audio.Channels === 2 ? "Stereo" : `${audio.Channels}ch`));
          
          let baseFilename = "";
          if (meta.isTv) {
            const sNum = String(meta.seasonIndex).padStart(2, "0");
            const eNum = String(meta.episodeIndex).padStart(2, "0");
            baseFilename = `${meta.seriesName} - S${sNum}E${eNum} - ${meta.episodeName} - [${langName} ${codecName} ${channels}].${ext}`;
          } else {
            const yearStr = meta.year ? ` (${meta.year})` : "";
            baseFilename = `${meta.title}${yearStr} - [${langName} ${codecName} ${channels}].${ext}`;
          }

          const safeFilename = sanitizeFilename(baseFilename);
          const targetPath = path.join(downloadDir, safeFilename);

          tasks.push({
            type: "audio",
            typeLabel: "Ses",
            name: safeFilename,
            itemId: itemId,
            sourceId: selectedSource.Id,
            container: container,
            audioStream: audio,
            outputPath: targetPath,
            totalDurationSeconds: totalDurationSeconds
          });
        }

        const res = await promptExecutionChoice(tasks, queue, client);
        if (res === "BACK") {
          continue; // 1 adım geri: Ses parçası seçimi
        }
        return "DONE";
      }
    } else if (dlType === "2") {
      // SADECE ALTYAZI
      if (subtitleStreams.length === 0) {
        console.log(`\n${C.yellow}[UYARI] Bu sürüm içerisinde altyazı akışı bulunamadı.${C.reset}`);
        await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
        continue;
      }

      while (true) {
        printHeader("ALTYAZI SEÇİMİ");
        subtitleStreams.forEach((sub, idx) => {
          const langCode = (sub.Language || "und").toLowerCase();
          const langName = LANG_NAMES[langCode] || sub.Language || "Altyazı";
          const codec = (sub.Codec || "srt").toUpperCase();
          const title = sub.DisplayTitle || sub.Title || "";
          const forced = sub.IsForced ? ` ${C.brightYellow}[Forced]${C.reset}` : "";
          const def = sub.IsDefault ? ` ${C.cyan}[Varsayılan]${C.reset}` : "";

          console.log(`  ${C.green}[${idx + 1}]${C.reset} ${C.brightYellow}[${langName}]${C.reset} ${codec} - ${C.dim}${title}${C.reset}${forced}${def}`);
        });
        console.log(`  ${C.brightCyan}[H]${C.reset} Tüm Altyazıları İndir (Hepsi)`);
        console.log(`  ${C.dim}[0] İndirme Türü Seçimine Dön${C.reset}\n`);

        const sChoice = await ask(`${C.bold}Seçiminiz (Örn: 1 veya 1,2 veya H, 0: Geri): ${C.reset}`);
        if (sChoice === "0" || !sChoice) {
          break; // 1 adım geri: İndirme Türü Seçimi
        }

        let selectedSubs = [];
        if (sChoice.toUpperCase() === "H" || sChoice.toUpperCase() === "HEPSI") {
          selectedSubs = subtitleStreams;
        } else {
          const indices = sChoice.split(",").map(x => parseInt(x.trim(), 10) - 1);
          for (const i of indices) {
            if (subtitleStreams[i]) selectedSubs.push(subtitleStreams[i]);
          }
        }

        if (selectedSubs.length === 0) {
          console.log(`${C.red}[HATA] Geçerli bir altyazı seçimi yapılmadı.${C.reset}`);
          await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
          continue;
        }

        const tasks = [];
        for (const sub of selectedSubs) {
          const subExt = sub.Codec === "ass" ? "ass" : (sub.Codec === "vtt" ? "vtt" : "srt");
          const langCode = (sub.Language || "und").toLowerCase();
          const langName = LANG_NAMES[langCode] || sub.Language || "Altyazı";
          const forcedTag = sub.IsForced ? " Forced" : "";

          let baseFilename = "";
          if (meta.isTv) {
            const sNum = String(meta.seasonIndex).padStart(2, "0");
            const eNum = String(meta.episodeIndex).padStart(2, "0");
            baseFilename = `${meta.seriesName} - S${sNum}E${eNum} - ${meta.episodeName} - [${langName}${forcedTag}].${subExt}`;
          } else {
            const yearStr = meta.year ? ` (${meta.year})` : "";
            baseFilename = `${meta.title}${yearStr} - [${langName}${forcedTag}].${subExt}`;
          }

          const safeFilename = sanitizeFilename(baseFilename);
          const targetPath = path.join(downloadDir, safeFilename);

          tasks.push({
            type: "subtitle",
            typeLabel: "Altyazı",
            name: safeFilename,
            itemId: itemId,
            sourceId: selectedSource.Id,
            subtitleStream: sub,
            outputPath: targetPath
          });
        }

        const res = await promptExecutionChoice(tasks, queue, client);
        if (res === "BACK") {
          continue; // 1 adım geri: Altyazı seçimi
        }
        return "DONE";
      }
    } else if (dlType === "3") {
      // TÜM DOSYAYI (VİDEO) İNDİR
      let baseFilename = "";
      if (meta.isTv) {
        const sNum = String(meta.seasonIndex).padStart(2, "0");
        const eNum = String(meta.episodeIndex).padStart(2, "0");
        baseFilename = `${meta.seriesName} - S${sNum}E${eNum} - ${meta.episodeName}.${container}`;
      } else {
        const yearStr = meta.year ? ` (${meta.year})` : "";
        baseFilename = `${meta.title}${yearStr}.${container}`;
      }

      const safeFilename = sanitizeFilename(baseFilename);
      const targetPath = path.join(downloadDir, safeFilename);

      const tasks = [{
        type: "video",
        typeLabel: "Video",
        name: safeFilename,
        itemId: itemId,
        sourceId: selectedSource.Id,
        container: container,
        outputPath: targetPath,
        expectedSize: selectedSource.Size || 0
      }];

      const res = await promptExecutionChoice(tasks, queue, client);
      if (res === "DONE") {
        return "DONE";
      }
    } else if (dlType === "4") {
      // TÜMÜNÜ İNDİR
      const tasks = [];
      let videoBase = "";
      if (meta.isTv) {
        const sNum = String(meta.seasonIndex).padStart(2, "0");
        const eNum = String(meta.episodeIndex).padStart(2, "0");
        videoBase = `${meta.seriesName} - S${sNum}E${eNum} - ${meta.episodeName}.${container}`;
      } else {
        const yearStr = meta.year ? ` (${meta.year})` : "";
        videoBase = `${meta.title}${yearStr}.${container}`;
      }
      const safeVideoName = sanitizeFilename(videoBase);
      tasks.push({
        type: "video",
        typeLabel: "Video",
        name: safeVideoName,
        itemId: itemId,
        sourceId: selectedSource.Id,
        container: container,
        outputPath: path.join(downloadDir, safeVideoName),
        expectedSize: selectedSource.Size || 0
      });

      for (const audio of audioStreams) {
        const ext = getAudioExtension(audio.Codec);
        const langCode = (audio.Language || "und").toLowerCase();
        const langName = LANG_NAMES[langCode] || audio.Language || "Audio";
        const codecName = (audio.Codec || "audio").toUpperCase();
        const channels = audio.Channels === 8 ? "7.1" : (audio.Channels === 6 ? "5.1" : (audio.Channels === 2 ? "Stereo" : `${audio.Channels}ch`));
        
        let baseAudio = "";
        if (meta.isTv) {
          const sNum = String(meta.seasonIndex).padStart(2, "0");
          const eNum = String(meta.episodeIndex).padStart(2, "0");
          baseAudio = `${meta.seriesName} - S${sNum}E${eNum} - ${meta.episodeName} - [${langName} ${codecName} ${channels}].${ext}`;
        } else {
          const yearStr = meta.year ? ` (${meta.year})` : "";
          baseAudio = `${meta.title}${yearStr} - [${langName} ${codecName} ${channels}].${ext}`;
        }
        const safeAudio = sanitizeFilename(baseAudio);
        tasks.push({
          type: "audio",
          typeLabel: "Ses",
          name: safeAudio,
          itemId: itemId,
          sourceId: selectedSource.Id,
          container: container,
          audioStream: audio,
          outputPath: path.join(downloadDir, safeAudio),
          totalDurationSeconds: totalDurationSeconds
        });
      }

      for (const sub of subtitleStreams) {
        const subExt = sub.Codec === "ass" ? "ass" : (sub.Codec === "vtt" ? "vtt" : "srt");
        const langCode = (sub.Language || "und").toLowerCase();
        const langName = LANG_NAMES[langCode] || sub.Language || "Altyazı";
        const forcedTag = sub.IsForced ? " Forced" : "";

        let baseSub = "";
        if (meta.isTv) {
          const sNum = String(meta.seasonIndex).padStart(2, "0");
          const eNum = String(meta.episodeIndex).padStart(2, "0");
          baseSub = `${meta.seriesName} - S${sNum}E${eNum} - ${meta.episodeName} - [${langName}${forcedTag}].${subExt}`;
        } else {
          const yearStr = meta.year ? ` (${meta.year})` : "";
          baseSub = `${meta.title}${yearStr} - [${langName}${forcedTag}].${subExt}`;
        }
        const safeSub = sanitizeFilename(baseSub);
        tasks.push({
          type: "subtitle",
          typeLabel: "Altyazı",
          name: safeSub,
          itemId: itemId,
          sourceId: selectedSource.Id,
          subtitleStream: sub,
          outputPath: path.join(downloadDir, safeSub)
        });
      }

      const res = await promptExecutionChoice(tasks, queue, client);
      if (res === "DONE") {
        return "DONE";
      }
    }
  }
}

// ==========================================
// İŞLEM TÜRÜ SEÇİMİ (HEMEN / KUYRUK)
// ==========================================
async function promptExecutionChoice(tasks, queue, client) {
  while (true) {
    console.log(`\n${C.bold}Seçilen Görev Sayısı: ${C.green}${tasks.length}${C.reset}`);
    console.log(`  ${C.green}[1]${C.reset} Hemen İndir`);
    console.log(`  ${C.cyan}[2]${C.reset} Kuyruğa Ekle`);
    console.log(`  ${C.dim}[0] Geri Dön${C.reset}\n`);

    const execChoice = await ask(`${C.bold}İşlem seçin (1-2, 0: Geri): ${C.reset}`);
    if (execChoice === "0" || !execChoice) {
      return "BACK"; // 1 adım geri
    }

    if (execChoice === "2") {
      queue.addAll(tasks);
      console.log(`\n${C.green}[BILGI] ${tasks.length} adet görev indirme kuyruğuna eklendi.${C.reset}\n`);
      await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
      return "DONE";
    } else if (execChoice === "1") {
      queue.addAll(tasks);
      await queue.processQueue(client);
      await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
      return "DONE";
    }
  }
}

// ==========================================
// PROGRAM BAŞLANGIÇ NOKTASI (MAIN)
// ==========================================
async function main() {
  clearScreen();
  
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch (e) {
    console.error(`${C.red}${C.bold}[HATA] Sisteminizde 'ffmpeg' bulunamadı.${C.reset}`);
    console.error(`Dönüştürmesiz ses akışı çıkarma işlemi için ffmpeg gereklidir.`);
    console.error(`Kurulum komutu: sudo apt install ffmpeg`);
    process.exit(1);
  }

  try {
    const queue = new DownloadQueue();
    const client = await setupAuthentication();
    await searchMenu(client, queue);
  } catch (err) {
    console.error(`\n${C.red}[HATA] Beklenmeyen Durum: ${err.message}${C.reset}`);
    process.exit(1);
  }
}

module.exports = {
  EmbyClient,
  DownloadQueue,
  cleanFilenameToTitle,
  getAudioExtension,
  parseSelectionIndices,
  downloadAudioStream,
  downloadSubtitle,
  downloadFullVideo
};

if (require.main === module) {
  main();
}
