# emby-audio-downloader

Emby medya sunucularından doğrudan ses akışı indirme aracı. Yeniden kodlama (transcoding) yapmadan, kaynaktaki orijinal ses akışını (stream copy) yerel depolama birimine aktarır.

## Gereksinimler

- Node.js (>= 18.0.0)
- FFmpeg (sistem PATH dizininde tanımlı)

## Kurulum

```bash
git clone https://github.com/Omc725/emby-audio-downloader.git
cd emby-audio-downloader
chmod +x emby-audio-downloader.js
```

## Kullanım

```bash
node emby-audio-downloader.js
```

veya npm üzerinden:

```bash
npm start
```

## Teknik Özellikler

- Doğrudan Ses Akışı: Sunucudan video akışını çekmeden yalnızca seçilen ses kanalını (`/Audio/{ItemId}/stream.mka`) indirir.
- Kayıpsız Aktarım: `-c:a copy` parametresi kullanılarak ses kodeki dönüştürülmeden aktarılır.
- Kapsayıcı Desteği: AC3, EAC3, DTS, TrueHD, AAC, MP3, FLAC, Opus formatlarını uygun dosya uzantılarına (`.ac3`, `.eac3`, `.dts`, `.mka`, `.m4a`, `.mp3`, `.flac`, `.opus`) otomatik eşler.
- Ağ Kurtarma: HTTP Range yeniden bağlanma bayrakları (`-reconnect 1`, `-reconnect_streamed 1`, `-reconnect_delay_max 15`) ve otomatik yeniden deneme döngüsü ile bağlantı kesintilerini tolere eder.
- Arama ve Gezinme: Başlık/dosya adı arama, TMDB/IMDb ID sorgulama ve dizi sezon/bölüm hiyerarşisi üzerinden seçim imkanı sunar.

## Yapılandırma

Oturum verileri `~/.config/emby-audio-downloader/config.json` dizininde saklanır.
