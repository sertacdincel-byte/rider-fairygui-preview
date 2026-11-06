# FairyGUI Preview

[English](README.md) · **Türkçe**

FairyGUI component XML dosyalarının canlı görsel önizlemesini XML editörünün yanında gösteren bir Rider eklentisi.

FairyGUI editöründe yapılan her ekran `<proje>/assets/<Paket>/` altında bir component `.xml` dosyası olarak kaydedilir. Rider'da açınca XML her zamanki gibi görünür; editörün sağ üst köşesindeki **Preview** ve **Split** düğmeleri (Markdown önizlemesindekilerin aynısı) ekranın nasıl göründüğünü gösterir.

| Özellik | Ayrıntı |
|---|---|
| Canlı | Önizleme kaydedilmemiş değişiklikleri yazarken takip eder. Projedeki başka bir component, görsel ya da `package.xml` kaydedilince yenilenir. |
| Çizim | İç içe component'ler (her derinlikte, paketler arası), görseller (9-slice, tile, tint, flip, fill), text ve rich text (UBB, stroke, gölge, shrink / ellipsis), graph'lar, loader'lar (görsel ya da component, tüm fill modları), list'ler (column, row, flow, pagination), group'lar, movie clip ve Spine için yer tutucular |
| Component mantığı | Label / Button / ProgressBar / Slider instance override'ları (title, icon, renk, font boyutu, checked, value), `<property>` override'ları, instance üzerinde ayarlanan controller sayfaları, controller `change_page` action'ları, "specific" ana sayfalar, gear'lar (display, display2, XY, size, look, color, icon, text, font size), maskeler |
| Yerleşim | Relation'lar FairyGUI'nin kendi olay sırasıyla (`RelationItem` mantığı) yeniden oynatılır: parent ve kardeş hedefler, percent ve ext tipleri, boyut değişince pivot kayması, eleman kendi boyutunu değiştirince kenarın korunması, group taşımaları ve doğrudan `<component>` altındaki relation'lar. Otomatik boyutlu yazılar projenin fontuyla ölçülür. |
| Controller'lar | Component'in controller'larından istediğin sayfayı araç çubuğundan seç; gear'lar ona göre değişir |
| Ekranlar | Tam ekran component'ler, projenin Adaptation ayarlarındaki her cihaz çözünürlüğünde önizlenebilir; relation'lar yeni boyuta göre yeniden çalışır |
| Gezinme | Bir elemana tıklayınca XML'de imleç o elemanın etiketine gider. İmleci hareket ettirince eleman önizlemede vurgulanır. İç içe bir component'e çift tıklayınca kendi dosyası açılır. Durum çubuğu fare altındaki elemanın yolunu, türünü, konumunu, boyutunu ve kaynak dosyasını gösterir. |
| Diff | Bir component'in herhangi bir diff'inde (Git log → Show Diff, Commit / Local Changes, Compare with Branch…) diff penceresinin görüntüleyici seçicisinden **FairyGUI preview**'ı seç. İki revizyon yan yana çizilir; eklenen (yeşil), silinen (kırmızı) ve değişen (turuncu) elemanlar çerçevelenir ve panellerin üstünde listelenir; yakınlaştırma, kaydırma ve fare vurgusu senkron kalır. |
| Seçenekler | Yakınlaştırma (sığdır, %25–200), `visible="false"` elemanları göster, her elemanın çerçevesini çiz, URL'si olmayan loader'ları işaretle, dolgu rengi olmayan graph'ları boya |

Her şey IDE'nin gömülü tarayıcısında, yerelde çalışır ve sadece FairyGUI projesinin kendi dosyalarını okur.

---

## Kurulum

### Eklenti deposundan (önerilen)

Güncellemeler IDE üzerinden otomatik gelir.

1. Rider → **Settings → Plugins → ⚙ → Manage Plugin Repositories… → +** ile şu adresi ekle:
   ```
   https://github.com/sertacdincel-byte/rider-fairygui-preview/releases/latest/download/updatePlugins.xml
   ```
2. **Marketplace** sekmesinde *FairyGUI Preview* ara → **Install** → Rider'ı yeniden başlat.
3. Kontrol: FairyGUI projesindeki bir component `.xml` dosyasını aç → editörün sağ üst köşesinde **Split**'e tıkla. Component'in çizilmiş hali XML'in yanında görünmeli.

Bu adres her zaman en yeni GitHub release'ini gösterir; o release'teki `updatePlugins.xml` de aynı release'in zip'ini işaret eder. Yeni sürümler normal eklenti güncellemesi olarak görünür.

### Diskten

[Releases](https://github.com/sertacdincel-byte/rider-fairygui-preview/releases) sayfasından `FguiPreview-<sürüm>.zip` dosyasını indir (zip'i açma) → **Settings → Plugins → ⚙ → Install Plugin from Disk…** → zip'i seç → yeniden başlat. Bu yolla güncellemeler otomatik gelmez.

### Kullanım

FairyGUI projesindeki herhangi bir component `.xml` dosyasını aç, sonra editörün sağ üst köşesinde **Preview** ya da **Split**'e tıkla. Seçim dosya başına hatırlanır. Önizlemenin arkasındaki tarayıcı ancak önizleme gösterildiğinde oluşturulur; XML görünümünde tuttuğun dosyalar ek bir yük getirmez. Her önizleme tarayıcısı ayrı bir Chromium sürecidir; bir dakika boyunca gizli kalan (başka sekme ya da Editor düzeni) önizlemenin tarayıcısı bırakılır. Tekrar gösterildiğinde sayfa aynı zoom, ekran, controller sayfaları ve seçeneklerle yeniden kurulur (kaydırma konumu baştan başlar).

### Kaldırma

**Settings → Plugins → Installed → FairyGUI Preview → Uninstall**, ardından yeniden başlat.

### Hangi dosyalar önizleme alır

Bir `.xml` dosyası şu koşulların hepsi sağlanınca önizleme alır:

- üst klasörü bir `*.fairy` proje dosyası içeren bir `assets` klasörünün altındadır,
- `package.xml` değildir,
- kök elemanı `<component>`'tir.

### Uyumluluk

| | |
|---|---|
| IDE | Rider 2026.2 (build 262) ve sonrası. Rider 2026.2.3.1 ile derlendi ve kullanıldı. |
| FairyGUI | Editör proje formatı 5.x (`projectDescription version="5.0"`). |
| İşletim sistemi | Windows 11'de geliştirildi. İşletim sistemine özel kod yok; macOS ve Linux denenmedi. |

---

## Önizlemenin göstermedikleri

Önizlemeye yerleşim kararlarında güvenmeden önce bunları oku.

- **Safe area ve çentikler modellenmez.** *Screen* listesi yalnızca tasarım çözünürlüğü ölçeklemesini (`ScaleWithScreenSize`, genişlik ya da yüksekliğe uyma) uygular ve relation'ları yeniden çalıştırır. Projenin safe-area kodunun runtime'da yaptığı hiçbir şey yansımaz.
- **Transition'lar oynatılmaz**; group'ların gelişmiş yerleşimleri (group üzerinde `layout="row"` vb.) yeniden hesaplanmaz. Elemanlar XML'in koyduğu yerde kalır. Group sınırları üyelerinden yeniden hesaplanmaz.
- **Yazı ölçüleri tarayıcınındır.** Otomatik boyutlu yazılar projenin varsayılan fontuyla tarayıcıda ölçülür; bu, TextMeshPro'dan birkaç piksel farklı olabilir ve bir etikete bağlı öğeler o kadar kayabilir.
- **Diff'te sadece karşılaştırılan dosya revizyondan gelir.** İç içe component'ler, görseller ve `package.xml` çalışma kopyasından okunur; iç içe bir component'teki değişiklik iki tarafta da görünür. Bir PR yepyeni bir ekran eklediğinde, onun yeni iç component'leri ve görselleri genelde çalışma kopyanda henüz yoktur; branch'i checkout edene kadar eksik (pembe kutu) görünürler.
- **Kayıtlı controller sayfaları kaydedildiği gibi gösterilir.** Önizleme her controller'ın dosyada seçili olan sayfasıyla başlar; tasarımcının seçili bıraktığı bir overlay sayfası (örneğin "ödeme başarılı" durumu) üstte görünür. Sayfayı araç çubuğundan değiştir.
- **Dolgu rengi olmayan graph'lar varsayılan olarak kesikli çerçeveyle çizilir.** Bunlar genellikle tıklama alanları ya da runtime'da eklenen VFX'lerin yer tutucularıdır. FairyGUI'nin kendisi onları beyaz boyar; **Plain graphs** düğmesi de aynısını yapar.
- **Renkler yaklaşıktır.** Oyun linear color space'te çizilir; önizleme, FairyGUI editörü gibi gamma renkleri gösterir. Yazılar projenin varsayılan fontunu kullanır; TextMeshPro outline ve face dilate CSS ile yaklaşık olarak çizilir.
- Sadece runtime'da var olan şeyler (kodla eklenen list elemanları, dinamik loader URL'leri, kodla atanan yazılar) XML'de nasılsa öyle görünür: list'ler `<item>` girişlerini, boş loader'lar kesikli bir kutu gösterir.

---

## Sorun giderme

| Belirti | Neden / çözüm |
|---|---|
| Bir XML dosyasında Preview / Split düğmeleri yok | Dosya *Hangi dosyalar önizleme alır* kurallarını sağlamıyor. FairyGUI proje klasöründe `.fairy` dosyasının durduğunu kontrol et. |
| "…needs the embedded browser (JCEF)…" | IDE, JCEF içermeyen bir Java runtime ile çalışıyor. Paketle gelene geri dön: **Help → Find Action → Choose Boot Java Runtime for the IDE**. |
| Kırmızı şerit "XML error in …" | XML okunamıyor (çoğu zaman düzenlemenin ortasında). Önizleme, XML tekrar okunabilir olana kadar son geçerli hâli gösterir. |
| Kırmızı şerit "Missing resources (…)" | XML'in kullandığı bir görsel ya da component projenin `package.xml`'inde ya da diskte yok. Eksikler pembe kesikli kutu olarak çizilir. |
| Önizleme başka bir dosyadaki değişikliği almadı | O dosyayı kaydet ya da önizleme araç çubuğunda **Reload**'a bas. |
| Diff penceresinde **FairyGUI preview** yok | Görüntüleyici yalnızca karşılaştırılan dosya bir FairyGUI projesindeki component ise sunulur. Diff araç çubuğunun görüntüleyici seçicisinden bir kez seç; diff penceresi seçimi hatırlar. Bir component diff'i yine de sunmuyorsa debug log'u aç (aşağıda) ve `idea.log`'da "FairyGUI preview not offered" ara. |

**Log'lar**: **Help → Show Log in Explorer** → `idea.log` dosyasında `com.bytelab.fguipreview` ara. Daha fazla ayrıntı için **Help → Diagnostic Tools → Debug Log Settings…** içine `#com.bytelab.fguipreview` ekle. **Sayfa hataları**: önizlemeye sağ tıkla → **Open DevTools**.

---

## Geliştirme

### Derleme

Gerekenler: bilgisayarda kurulu bir Rider (içindeki JBR `javac` sağlar) ve Node.js 18+. Gradle gerekmez.

```powershell
./build.ps1                                   # sayfa paketi + Java + zip
./build.ps1 -SkipWeb                          # commit'lenmiş preview.html'i kullan
./build.ps1 -RiderHome "D:\Apps\Rider"        # Rider farklı bir yerde kuruluysa
./build.ps1 -RepositoryUrl https://host/path  # ayrıca updatePlugins.xml üret
```

Çıktı: `build/distributions/FguiPreview-<sürüm>.zip`; `-RepositoryUrl` verilirse ayrıca `updatePlugins.xml`. Java kodu kurulu Rider'ın `lib/*` ve `plugins/jcef-plugin/lib/modules/*` jar'larına karşı derlenir.

### Sürüm çıkarma

1. `src/main/resources/META-INF/plugin.xml` içindeki `<version>` değerini artır ve `<change-notes>`'a bir giriş ekle.
2. `CHANGELOG.md`'ye `## <sürüm> — <tarih>` başlıklı bir bölüm ekle.
3. Sayfada değişiklik yaptıysan `preview.html`'in yeniden üretilmesi için `./build.ps1` çalıştır.
4. Zip'i bir kez diskten kurup birkaç gerçek ekranı dene.
5. Commit'le, sonra `./release.ps1` çalıştır (release'i önce GitHub'da incelemek için `-Draft` ekle). Script çalışma ağacı temiz değilse, etiket zaten varsa ya da CHANGELOG bölümü yoksa durur; `HEAD`'i push'lar ve zip ile ona işaret eden `updatePlugins.xml` dosyasını içeren `v<sürüm>` release'ini oluşturur.

### Klasör yapısı

| Yol | İçerik |
|---|---|
| `src/main/java/com/bytelab/fguipreview/FguiEditorProvider.java` | Component XML dosyaları için bölünmüş editör (metin editörü + önizleme) |
| `src/main/java/com/bytelab/fguipreview/FguiPreviewEditor.java` | Bölünmüş editörün önizleme yarısı: canlı kaynak, imleç ↔ eleman eşlemesi |
| `src/main/java/com/bytelab/fguipreview/FguiDiffTool.java` | Diff penceresindeki "FairyGUI preview" görüntüleyicisi |
| `src/main/java/com/bytelab/fguipreview/FguiPage.java` | İkisinin ortak JCEF sayfası: geç oluşturulan tarayıcı, sayfa köprüsü, dosya okuma, değişiklik takibi |
| `src/main/java/com/bytelab/fguipreview/FguiProject.java` | FairyGUI projesini bulur ve hangi dosyaların component olduğuna karar verir |
| `src/main/resources/fguipreview/preview.html` | Üretilmiş tek dosyalık sayfa. Elle düzenleme; web derlemesini çalıştır |
| `web/src/` | Sayfa kaynağı: `preview.js` (renderer) ve `preview.html` şablonu; `web/build.mjs` ile paketlenir |
| `web/test/serve.mjs` | Sayfayı IDE olmadan bir FairyGUI projesine karşı sunar |

### Sayfa API'si

Eklenti `preview.html`'i yükler ve sayfayla, sayfaya `FguiHost.request(json)` olarak açılan bir `JBCefJSQuery` üzerinden konuşur:

| İstek | Yanıt |
|---|---|
| `{op:"index"}` | `{packages:[{folder, xml}], common, adaptation}`: tüm `package.xml`'ler, `settings/Common.json` ve `settings/Adaptation.json` |
| `{op:"read", path, enc:"text"}` | Dosya metni; editörde kaydedilmemiş değişiklik varsa açık belgeden |
| `{op:"read", path, enc:"base64", offset, length}` | `"<toplam boyut>:<base64 parça>"`; sayfa binary dosyaları 512 KB'lık parçalarla okur |
| `{op:"nav", id}` | İmleci elemanın etiketine taşır |
| `{op:"open", file}` | Başka bir component'i editörde açar |

Yollar projenin `assets` klasörüne görelidir. Eklenti sayfada `FguiPreview.init / initDiff / setSource / invalidate / highlight` çağırır.

### Sayfayı IDE olmadan test etme

```powershell
node web/test/serve.mjs <FairyGUI proje klasörünün yolu>
```

`http://127.0.0.1:47912/?file=<Paket>/<yol>.xml` adresini aç (açık tema için `&dark=0`, o revizyona karşı diff görünümü için `&rev=<git revizyonu>`). Script aynı host API'sini diskten sunar ve `nav` / `open` isteklerini log'a yazar.
