#!/usr/bin/env node

/**
 * Emby Audio Stream Downloader (CLI)
 * 
 * Emby sunucusundan dönüştürme (transcoding) yapmadan
 * doğrudan orijinal ses akışlarını (audio stream copy) indiren terminal aracı.
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

function ensureConfigDir() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  } catch (e) {}
}

function loadConfig() {
  ensureConfigDir();
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      return data;
    } catch (e) {
      return { savedServers: [] };
    }
  }
  return { savedServers: [] };
}

function saveConfig(config) {
  ensureConfigDir();
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

// ==========================================
// TERMİNAL GİRİŞ / ÇIKIŞ YARDIMCILARI
// ==========================================
let rl = null;

function getReadLine() {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return rl;
}

function ask(questionText) {
  return new Promise((resolve) => {
    try {
      const iface = getReadLine();
      if (!iface || iface.closed) {
        return resolve("");
      }
      let answered = false;
      const onClose = () => {
        if (!answered) {
          answered = true;
          resolve("");
        }
      };
      iface.once("close", onClose);
      iface.question(questionText, (answer) => {
        if (!answered) {
          answered = true;
          iface.removeListener("close", onClose);
          resolve(answer.trim());
        }
      });
    } catch (err) {
      resolve("");
    }
  });
}

function askPassword(questionText) {
  return new Promise((resolve) => {
    if (rl) {
      rl.close();
      rl = null;
    }

    process.stdout.write(questionText);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();

    let password = "";
    const onData = (ch) => {
      ch = ch.toString("utf8");
      if (ch === "\n" || ch === "\r" || ch === "\u0004") {
        if (stdin.setRawMode) stdin.setRawMode(wasRaw);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(password.trim());
      } else if (ch === "\u0003") {
        // Ctrl+C
        process.stdout.write("\n");
        process.exit(0);
      } else if (ch === "\b" || ch === "\x7f") {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        password += ch;
        process.stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[0f");
}

function printHeader(title) {
  console.log(`\n${C.bold}${C.cyan}╔═══════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║${C.brightWhite}  ${title.padEnd(65)} ${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚═══════════════════════════════════════════════════════════════════╝${C.reset}\n`);
}

function sanitizeFilename(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return "";
  const b = Number(bytes);
  if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(0) + " KB";
  return b + " B";
}

function getAudioExtension(codec) {
  const c = String(codec || "").toLowerCase();
  if (c === "ac3") return "ac3";
  if (c === "eac3") return "eac3";
  if (c === "dts" || c.startsWith("dts")) return "dts";
  if (c === "flac") return "flac";
  if (c === "mp3") return "mp3";
  if (c === "aac") return "m4a";
  if (c === "opus") return "opus";
  if (c === "vorbis") return "ogg";
  if (c.startsWith("pcm")) return "wav";
  if (c === "truehd" || c === "thd") return "mka";
  return "mka";
}

// ==========================================
// EMBY API İSTEMCİSİ
// ==========================================
class EmbyClient {
  constructor(serverUrl, port, username, token = null, userId = null, serverName = "") {
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.port = port;
    this.username = username;
    this.token = token;
    this.userId = userId;
    this.serverName = serverName;
    this.prefix = "";
  }

  getHeaders() {
    const headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Emby-Authorization": 'MediaBrowser Client="EmbyAudioDownloader", Device="Terminal", DeviceId="emby-audio-dl-cli", Version="1.0.0"'
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

    // 2. Dosya adı temizleme: eğer kullanıcı dosya adı girdiyse
    // Örnek: "The Matrix (1999) [imdbid-tt0133093] - 2160P - Filmbol.mkv" -> "The Matrix"
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

    // 3. Eğer hiç Movie/Series bulunamadıysa (örneğin kullanıcı tam bir bölüm dosya adı girdiğinde),
    // types filtresiz arayıp bulunan Episode öğelerinin ana Dizisini (Series) ekle!
    if (results.length === 0) {
      try {
        const anyUrl = `${this.serverUrl}${this.prefix}/Users/${this.userId}/Items?SearchTerm=${encodeURIComponent(rawQuery)}&Recursive=true&Limit=10&api_key=${this.token}`;
        const res = await fetch(anyUrl, { headers: this.getHeaders() });
        if (res.ok) {
          const data = await res.json();
          for (const item of (data.Items || [])) {
            if (item.Type === "Episode" && item.SeriesId && !seenIds.has(item.SeriesId)) {
              // Üst diziyi getir
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

    // TMDB API Fallback: Eğer Emby'de doğrudan ID eşleşmediyse TMDB'den başlık çekip arayalım
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
    const url = `${this.serverUrl}${this.prefix}/Shows/${seriesId}/Episodes?${seasonQuery}UserId=${this.userId}&api_key=${this.token}`;
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

// Dosya adını temizleyip film/dizi adına dönüştürür
function cleanFilenameToTitle(filename) {
  let s = path.basename(filename);
  s = s.replace(/\.[a-zA-Z0-9]{2,4}$/, ""); // uzantıyı at
  // Köşeli parantez veya süslü parantez içlerini temizle
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/\{[^}]*\}/g, " ");
  // Çözünürlük, codec, kaynak etiketlerini temizle
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
  // Nokta, alt çizgi, tireleri boşluğa çevir
  s = s.replace(/[._\-+]/g, " ");
  // Fazla boşlukları temizle
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
// DÖNÜŞTÜRMESİZ SES İNDİRME MOTORU (FFMPEG)
// ==========================================
function downloadAudioStream(directAudioUrl, fallbackVideoUrl, audioStream, outputPath, totalDurationSeconds = 0) {
  return new Promise(async (resolve, reject) => {
    // downloads klasörünün varlığını garanti et
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

            // Grafiksel İlerleme Çubuğu (20 karakter)
            const barWidth = 20;
            const filled = Math.min(barWidth, Math.round((percent / 100) * barWidth));
            const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

            // Toplam Boyut Hesaplaması
            let totalBytesEst = expectedTotalBytes;
            if (!totalBytesEst && percent > 0 && currentBytes > 0) {
              totalBytesEst = Math.round(currentBytes / (percent / 100));
            }
            const currentSizeStr = formatBytes(currentBytes);
            const totalSizeStr = totalBytesEst > 0 ? formatBytes(totalBytesEst) : "? MB";

            // İndirme Hızı ve Kalan Süre (ETA)
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
          process.stdout.write("\r" + " ".repeat(100) + "\r"); // Satırı temizle
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
        console.log(`\n${C.brightYellow}⚠ Bağlantı kesildi, 3 saniye sonra otomatik yeniden bağlanılıyor... (Deneme ${attempt}/${maxRetries})${C.reset}`);
        await new Promise(r => setTimeout(r, 3000));
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(e) {}
      }

      // 1. Strateji: Doğrudan yüksek hızlı Ses Akışı (stream.mka) - Sadece ses indirir, videoyu aktarmaz
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

      // 2. Strateji (Yedek): Statik video kapsayıcısından stream copy (-map 0:{streamIndex})
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
// KULLANICI ETKİLEŞİM VE AKIŞ ADIMLARI
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

    const choice = await ask(`${C.bold}Seçiminiz (Varsayılan 1): ${C.reset}`);
    if (choice === "0") {
      console.log("Çıkılıyor...");
      process.exit(0);
    }

    if (choice.toLowerCase() === "s") {
      saveConfig({ savedServers: [] });
      console.log(`${C.green}✓ Kayıtlı sunucular silindi.${C.reset}`);
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
          console.log(`${C.green}✓ Bağlantı başarılı!${C.reset}\n`);
          return client;
        } else {
          console.log(`${C.yellow}⚠ Kayıtlı oturumun süresi dolmuş, yeniden şifre gerekiyor.${C.reset}`);
          const pwd = await askPassword(`${C.bold}Şifre: ${C.reset}`);
          try {
            await client.authenticate(pwd);
            selected.token = client.token;
            selected.userId = client.userId;
            selected.password = pwd;
            selected.prefix = client.prefix;
            saveConfig(config);
            console.log(`${C.green}✓ Giriş başarılı!${C.reset}\n`);
            return client;
          } catch (e) {
            console.log(`${C.red}✗ Giriş yapılamadı: ${e.message}${C.reset}\n`);
          }
        }
      }
    }
  }

  // Yeni sunucu bilgisi isteme
  printHeader("YENİ EMBY SUNUCUSU TANIMLAMA");
  let serverAddr = await ask(`${C.bold}Sunucu Adresi (Örn: https://emby.example.com): ${C.reset}`);
  if (!serverAddr) {
    console.log(`${C.red}Hata: Sunucu adresi boş bırakılamaz.${C.reset}\n`);
    return await setupAuthentication();
  }

  // Port tespiti
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
    console.log(`${C.green}✓ Giriş başarılı! (Sunucu: ${client.serverName || "Emby"})${C.reset}\n`);

    // Kaydet
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
    console.log(`${C.red}✗ Bağlantı hatası: ${err.message}${C.reset}\n`);
    const retry = await ask("Yeniden denemek ister misiniz? (E/h): ");
    if (retry.toLowerCase() === "h") {
      process.exit(1);
    }
    return await setupAuthentication();
  }
}

async function searchMenu(client) {
  while (true) {
    printHeader(`EMBY SES İNDİRİCİ - ${client.serverUrl} (${client.username})`);
    console.log(`${C.bold}Arama Seçeneği:${C.reset}`);
    console.log(`  ${C.green}[1]${C.reset} İsim ile Arama ${C.dim}(Film / Dizi adı veya Dosya adı)${C.reset}`);
    console.log(`  ${C.green}[2]${C.reset} TMDB veya IMDb ID ile Arama ${C.dim}(Örn: tt0133093 veya 603)${C.reset}`);
    console.log(`  ${C.yellow}[3]${C.reset} Sunucu / Kullanıcı Değiştir`);
    console.log(`  ${C.dim}[0] Çıkış${C.reset}\n`);

    const choice = await ask(`${C.bold}Seçiminiz: ${C.reset}`);

    if (choice === "0" || choice === "") {
      console.log("Görüşmek üzere!");
      process.exit(0);
    } else if (choice === "3") {
      client = await setupAuthentication();
      continue;
    } else if (choice === "1") {
      const q = await ask(`\n${C.bold}Aranacak Film/Dizi Adı veya Dosya Adı: ${C.reset}`);
      if (!q) continue;
      console.log(`\n${C.cyan}Aranıyor: "${q}"...${C.reset}`);
      const items = await client.searchByName(q);
      await handleSearchResults(client, items);
    } else if (choice === "2") {
      const id = await ask(`\n${C.bold}TMDB veya IMDb ID (Örn: tt0133093 / 603): ${C.reset}`);
      if (!id) continue;
      console.log(`\n${C.cyan}ID sorgulanıyor: "${id}"...${C.reset}`);
      const items = await client.searchById(id);
      await handleSearchResults(client, items);
    }
  }
}

async function handleSearchResults(client, items) {
  if (!items || items.length === 0) {
    console.log(`\n${C.yellow}⚠ Aradığınız kriterlere uygun Film veya Dizi bulunamadı.${C.reset}\n`);
    await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
    return;
  }

  // Kullanıcıya dosya değil, film veya dizi olarak sunuyoruz!
  printHeader(`ARAMA SONUÇLARI (${items.length} Sonuç Bulundu)`);
  items.forEach((item, idx) => {
    const isTv = item.Type === "Series";
    const typeBadge = isTv ? `${C.brightMagenta}[Dizi]${C.reset}` : `${C.brightBlue}[Film]${C.reset}`;
    const yearStr = item.ProductionYear ? `(${item.ProductionYear}) ` : "";
    console.log(`  ${C.green}[${idx + 1}]${C.reset} ${C.bold}${item.Name}${C.reset} ${yearStr}${typeBadge}`);
  });
  console.log(`  ${C.dim}[0] İptal / Geri Dön${C.reset}\n`);

  const choice = await ask(`${C.bold}Lütfen bir içerik seçin (1-${items.length}): ${C.reset}`);
  if (choice === "0" || !choice) return;

  const selIdx = parseInt(choice, 10) - 1;
  const selectedItem = items[selIdx];
  if (!selectedItem) {
    console.log(`${C.red}Geçersiz seçim!${C.reset}`);
    return;
  }

  // Film veya Dizi dallanması
  if (selectedItem.Type === "Series") {
    await handleSeriesFlow(client, selectedItem);
  } else {
    await handleMovieFlow(client, selectedItem);
  }
}

async function handleSeriesFlow(client, seriesItem) {
  console.log(`\n${C.cyan}Dizi sezonları yükleniyor: "${seriesItem.Name}"...${C.reset}`);
  const seasons = await client.getSeasons(seriesItem.Id);

  if (!seasons || seasons.length === 0) {
    console.log(`${C.yellow}⚠ Bu dizi için sezon bulunamadı.${C.reset}`);
    return;
  }

  printHeader(`SEZON SEÇİMİ - ${seriesItem.Name}`);
  seasons.forEach((season, idx) => {
    console.log(`  ${C.green}[${idx + 1}]${C.reset} ${C.bold}${season.Name}${C.reset}`);
  });
  console.log(`  ${C.dim}[0] Geri Dön${C.reset}\n`);

  const sChoice = await ask(`${C.bold}Sezon seçin (1-${seasons.length}): ${C.reset}`);
  if (sChoice === "0" || !sChoice) return;

  const season = seasons[parseInt(sChoice, 10) - 1];
  if (!season) return;

  console.log(`\n${C.cyan}Bölümler yükleniyor: ${season.Name}...${C.reset}`);
  const episodes = await client.getEpisodes(seriesItem.Id, season.Id);

  if (!episodes || episodes.length === 0) {
    console.log(`${C.yellow}⚠ Bu sezonda bölüm bulunamadı.${C.reset}`);
    return;
  }

  printHeader(`BÖLÜM SEÇİMİ - ${seriesItem.Name} (${season.Name})`);
  episodes.forEach((ep, idx) => {
    const epNum = ep.IndexNumber !== undefined ? `Bölüm ${ep.IndexNumber}: ` : "";
    console.log(`  ${C.green}[${idx + 1}]${C.reset} ${C.bold}${epNum}${ep.Name}${C.reset}`);
  });
  console.log(`  ${C.dim}[0] Geri Dön${C.reset}\n`);

  const epChoice = await ask(`${C.bold}Bölüm seçin (1-${episodes.length}): ${C.reset}`);
  if (epChoice === "0" || !epChoice) return;

  const episode = episodes[parseInt(epChoice, 10) - 1];
  if (!episode) return;

  // Bölümün detaylarını ve MediaSources bilgisini al
  await handleItemVersionsAndAudio(client, episode.Id, {
    isTv: true,
    seriesName: seriesItem.Name,
    seasonIndex: season.IndexNumber !== undefined ? season.IndexNumber : 1,
    episodeIndex: episode.IndexNumber !== undefined ? episode.IndexNumber : 1,
    episodeName: episode.Name || `Bölüm ${episode.IndexNumber}`
  });
}

async function handleMovieFlow(client, movieItem) {
  await handleItemVersionsAndAudio(client, movieItem.Id, {
    isTv: false,
    title: movieItem.Name,
    year: movieItem.ProductionYear
  });
}

async function handleItemVersionsAndAudio(client, itemId, meta) {
  console.log(`\n${C.cyan}Medya kaynakları ve sürümler inceleniyor...${C.reset}`);
  const item = await client.getItemDetails(itemId);

  if (!item || !item.MediaSources || item.MediaSources.length === 0) {
    console.log(`${C.red}✗ Bu içerik için oynatılabilir medya kaynağı bulunamadı.${C.reset}`);
    await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
    return;
  }

  const sources = item.MediaSources;
  let selectedSource = null;

  // SÜRÜM KONTROLÜ:
  // Eğer tek sürüm varsa direkt indirmek istiyor musunuz ekranı gelsin
  // Eğer birden fazla sürüm varsa o sürümlerden biri seçilsin
  if (sources.length === 1) {
    const s = sources[0];
    const vName = s.Name || path.basename(s.Path || "Tek Sürüm");
    const container = (s.Container || "mkv").toUpperCase();
    const sizeStr = s.Size ? ` | ${formatBytes(s.Size)}` : "";
    
    printHeader("TEK SÜRÜM BULUNDU");
    console.log(`Bu içerik için mevcut tek bir sürüm var:`);
    console.log(`  ▶ ${C.bold}${C.brightGreen}${vName}${C.reset} [${container}${sizeStr}]\n`);

    const confirm = await ask(`${C.bold}Bu sürümden ses dosyasını indirmek istiyor musunuz? (E/h): ${C.reset}`);
    if (confirm.toLowerCase() === "h") {
      return;
    }
    selectedSource = s;
  } else {
    printHeader(`SÜRÜM SEÇİMİ (${sources.length} Farklı Sürüm Mevcut)`);
    sources.forEach((s, idx) => {
      const vName = s.Name || path.basename(s.Path || `Sürüm ${idx + 1}`);
      const container = (s.Container || "mkv").toUpperCase();
      const sizeStr = s.Size ? ` | ${formatBytes(s.Size)}` : "";
      
      const vStream = (s.MediaStreams || []).find(st => st.Type === "Video");
      const vCodec = vStream?.Codec ? ` | ${vStream.Codec.toUpperCase()}` : "";
      const vRes = vStream?.Height ? ` | ${vStream.Height}p` : "";

      console.log(`  ${C.green}[${idx + 1}]${C.reset} ${C.bold}${vName}${C.reset} ${C.dim}(${container}${sizeStr}${vCodec}${vRes})${C.reset}`);
    });
    console.log(`  ${C.dim}[0] İptal / Geri Dön${C.reset}\n`);

    const vChoice = await ask(`${C.bold}Lütfen indirmek istediğiniz sürümü seçin (1-${sources.length}): ${C.reset}`);
    if (vChoice === "0" || !vChoice) return;

    const sIdx = parseInt(vChoice, 10) - 1;
    selectedSource = sources[sIdx];
    if (!selectedSource) {
      console.log(`${C.red}Geçersiz sürüm seçimi!${C.reset}`);
      return;
    }
  }

  // SES DOSYALARI LİSTESİ
  const audioStreams = (selectedSource.MediaStreams || []).filter(st => st.Type === "Audio");
  if (audioStreams.length === 0) {
    console.log(`\n${C.yellow}⚠ Bu sürüm içerisinde ses akışı (audio stream) tespit edilemedi.${C.reset}`);
    await ask(`${C.dim}Devam etmek için Enter'a basın...${C.reset}`);
    return;
  }

  printHeader("SES PARÇASI SEÇİMİ (DÖNÜŞTÜRMESİZ)");
  console.log(`${C.bold}Bu dosya içerisindeki ses parçaları:${C.reset}`);
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
  console.log(`  ${C.dim}[0] İptal / Geri Dön${C.reset}\n`);

  const aChoice = await ask(`${C.bold}Hangi ses dosyasını / dosyalarını indirmek istiyorsunuz? (Örn: 1 veya 1,2 veya H): ${C.reset}`);
  if (aChoice === "0" || !aChoice) return;

  let selectedAudios = [];
  if (aChoice.toUpperCase() === "H" || aChoice.toUpperCase() === "HEPSI") {
    selectedAudios = audioStreams;
  } else {
    const indices = aChoice.split(",").map(x => parseInt(x.trim(), 10) - 1);
    for (const i of indices) {
      if (audioStreams[i]) {
        selectedAudios.push(audioStreams[i]);
      }
    }
  }

  if (selectedAudios.length === 0) {
    console.log(`${C.red}Geçerli bir ses seçimi yapılmadı!${C.reset}`);
    return;
  }

  // İNDİRME İŞLEMİ
  const downloadDir = path.resolve(process.cwd(), "downloads");
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  const totalDurationSeconds = (selectedSource.RunTimeTicks || item.RunTimeTicks)
    ? (selectedSource.RunTimeTicks || item.RunTimeTicks) / 10000000
    : 0;

  console.log(`\n${C.bold}${C.green}▶ Dönüştürme yapılmadan (Yüksek Hızlı Doğrudan Ses Akışı) indirme başlatılıyor...${C.reset}`);
  console.log(`${C.dim}Kayıt Dizini: ${downloadDir}${C.reset}\n`);

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

    console.log(`${C.bold}İndiriliyor:${C.reset} ${C.brightWhite}${safeFilename}${C.reset}`);
    console.log(`${C.dim}Akış İndeksi: 0:${audio.Index} (Codec: ${audio.Codec} -> Uzantı: .${ext})${C.reset}`);

    const directAudioUrl = client.buildDirectAudioStreamUrl(itemId, selectedSource, audio);
    const fallbackVideoUrl = client.buildStreamUrl(itemId, selectedSource);

    try {
      const startTime = Date.now();
      const res = await downloadAudioStream(directAudioUrl, fallbackVideoUrl, audio, targetPath, totalDurationSeconds);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`${C.green}✓ [TAMAMLANDI]${C.reset} Dosya başarıyla kaydedildi! (${res.formattedSize}, ${elapsed} sn)`);
      console.log(`  ${C.dim}Konum: ${res.path}${C.reset}\n`);
    } catch (err) {
      console.log(`${C.red}✗ [HATA] İndirme başarısız: ${err.message}${C.reset}\n`);
    }
  }

  console.log(`${C.bold}${C.brightGreen}✓ Tüm seçilen ses dosyası indirme işlemleri tamamlandı!${C.reset}\n`);
  await ask(`${C.dim}Arama menüsüne dönmek için Enter'a basın...${C.reset}`);
}

// ==========================================
// PROGRAM BAŞLANGIÇ NOKTASI (MAIN)
// ==========================================
async function main() {
  clearScreen();
  
  // ffmpeg kontrolü
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch (e) {
    console.error(`${C.red}${C.bold}HATA: Sisteminizde 'ffmpeg' bulunamadı!${C.reset}`);
    console.error(`Dönüştürmesiz ses akışı çıkarmak için ffmpeg gereklidir.`);
    console.error(`Linux üzerinde kurmak için: sudo apt install ffmpeg`);
    process.exit(1);
  }

  try {
    const client = await setupAuthentication();
    await searchMenu(client);
  } catch (err) {
    console.error(`\n${C.red}Beklenmeyen Hata: ${err.message}${C.reset}`);
    process.exit(1);
  }
}

// Dışa aktarma (test amacıyla da kullanılabilir)
module.exports = {
  EmbyClient,
  cleanFilenameToTitle,
  getAudioExtension,
  downloadAudioStream
};

if (require.main === module) {
  main();
}
