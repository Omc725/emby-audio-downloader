# emby-audio-downloader

Emby medya sunucularından dönüştürme (transcoding) yapmadan doğrudan ses akışı, altyazı ve orijinal video dosyalarını indiren CLI aracı.

## Gereksinimler

- Node.js (>= 18.0.0)
- FFmpeg (sistem PATH dizininde tanımlı, doğrudan ses akışı kopyalama için gereklidir)

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

## Temel Özellikler

- **Dönüştürmesiz Ses Akışı:** Video akışını çekmeksizin doğrudan ses kanalını (`/Audio/{ItemId}/stream.mka`) `-c:a copy` parametresiyle kayıpsız olarak indirir.
- **Dönüştürmesiz Doğrudan Video İndirme (Bit-for-bit):** Emby sunucusundaki orijinal video dosyasını hiçbir transcode, remux veya yeniden kodlama işlemine tabi tutmadan doğrudan indirir. Sunucu tarafında `static=true`, `EnableDirectPlay=true`, `EnableDirectStream=true`, `AllowVideoStreamCopy=true` ve `AllowAudioStreamCopy=true` bayrakları kullanılarak Emby dönüştürme motoru tamamen devre dışı bırakılır. Sunucudaki orijinal dosya adı ve uzantısı korunur; indirme bitiminde sunucu disk boyutu ile yerel dosya boyutu bayt düzeyinde doğrulanır.
- **Altyazı İndirme:** Emby altyazı akış uç noktası (`/Videos/{ItemId}/{MediaSourceId}/Subtitles/{Index}/Stream.srt`) üzerinden dahili veya harici altyazıları doğrudan metin formatında kaydeder.
- **İndirme Kuyruğu:** İçerikleri tek tek indirmek yerine kuyruğa ekleme, kuyruğu listeleme, düzenleme ve toplu başlatma desteği sunar. Oturumlar arasında kuyruk verisi `~/.config/emby-audio-downloader/queue.json` dosyasında saklanır.
- **Dizi Toplu İndirme:** Sezon bazında tüm sezonu (`T`) veya bölüm aralığını (`1-5`, `1,3,4`) seçerek toplu video, ses veya altyazı indirme imkanı sağlar.
- **Ağ Kesintisi Toleransı:** HTTP Range desteği (`Accept-Ranges: bytes`) ile yarıda kalan video indirmeleri baştan başlamak yerine kaldığı bayttan devam eder. Ses indirmelerinde ise FFmpeg ağ yeniden bağlanma bayrakları ve otomatik yeniden deneme mekanizması kullanılır.
- **Gerçek Zamanlı İlerleme:** Canlı terminal ilerleme çubuğu, yüzde, anlık indirme hızı (MB/s ve Mbps), indirilen/toplam boyut ve tahmini kalan süre (ETA) göstergesi sunar.

## Doğrudan Video İndirme Mimarisi

Video indirme sürecinde istemci doğrudan HTTP akışını yerel diske yazar:
- FFmpeg veya harici dönüştürücü çalıştırılmaz.
- Emby sunucusunun `DownloadContent` yetkisi varsa `/Items/{Id}/Download` uç noktası öncelikli kullanılır.
- Kullanıcı rolü indirme kısıtlamasına sahipse, doğrudan statik video akış uç noktası (`/Videos/{Id}/stream.{container}?static=true`) üzerinden ham dosya transfer edilir.
- Sunucu başlıklarında `Cache-Control: private, no-transform` ve tam içerik boyutu teyit edilir.

## Yapılandırma

Oturum ve sunucu profilleri `~/.config/emby-audio-downloader/config.json` dosyasında saklanır.
