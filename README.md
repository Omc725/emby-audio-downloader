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
- **Tam Dosya (Video) İndirme:** Statik akış uç noktası (`/Videos/{ItemId}/stream.{container}?static=true`) üzerinden video, ses ve gömülü altyazıları içeren tam medya dosyasını indirir.
- **Altyazı İndirme:** Emby altyazı akış uç noktası (`/Videos/{ItemId}/{MediaSourceId}/Subtitles/{Index}/Stream.srt`) üzerinden dahili veya harici altyazıları doğrudan metin formatında kaydeder.
- **İndirme Kuyruğu:** İçerikleri tek tek indirmek yerine kuyruğa ekleme, kuyruğu listeleme, düzenleme ve toplu başlatma desteği sunar. Oturumlar arasında kuyruk verisi `~/.config/emby-audio-downloader/queue.json` dosyasında saklanır.
- **Dizi Toplu İndirme:** Sezon bazında tüm sezonu (`T`) veya bölüm aralığını (`1-5`, `1,3,4`) seçerek toplu video, ses veya altyazı indirme imkanı sağlar.
- **Ağ Kesintisi Toleransı:** HTTP Range desteği (`Accept-Ranges: bytes`) ile yarıda kalan video indirmeleri baştan başlamak yerine kaldığı bayttan devam eder. Ses indirmelerinde ise FFmpeg ağ yeniden bağlanma bayrakları ve otomatik yeniden deneme mekanizması kullanılır.
- **Gerçek Zamanlı İlerleme:** Canlı terminal ilerleme çubuğu, yüzde, anlık indirme hızı (MB/s ve Mbps), indirilen/toplam boyut ve tahmini kalan süre (ETA) göstergesi sunar.

## Yapılandırma

Oturum ve sunucu profilleri `~/.config/emby-audio-downloader/config.json` dosyasında saklanır.
