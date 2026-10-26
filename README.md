# DIM Local – Web-App fürs iPhone

Die Web-Version von DIM Local. Sie läuft komplett im Browser und spricht direkt mit Bungie, ohne PC und ohne App Store. Auf dem iPhone legst du sie über Safari → Teilen → **Zum Home-Bildschirm** ab, danach startet sie wie eine App im Vollbild.

Der Funktionsumfang entspricht der Desktop-App: Inventar, Filter, Godroll-Finder, Loadouts inklusive DIM-Links, Subklasse, Mods, Artefakt, Transmog und Such-Shortcuts.

Nicht dabei sind:
- **Globale Hotkeys:** Auf dem Handy ergeben sie keinen Sinn.
- **Windows-Benachrichtigungen:** Die gibt es nur in der Desktop-App.

## 1. Online stellen (einmalig)

Die App braucht eine HTTPS-Adresse, damit Bungie nach dem Login dorthin zurückleiten kann. Kostenlos geht das z.B. so:

- **GitHub Pages:**
  1. Neues Repository anlegen und den Inhalt dieses Ordners hochladen. `test.mjs` und `README.md` dürfen mit.
  2. Unter *Settings → Pages* die Quelle auf den Branch `main` und den Ordner `/ (root)` stellen.
  3. Die Adresse lautet dann z.B. `https://<name>.github.io/<repo>/`.
- **Netlify Drop:** Den Ordner auf https://app.netlify.com/drop ziehen.
- **Cloudflare Pages:** Funktioniert genauso.

## 2. Bungie-App einrichten (einmalig)

Lege auf https://www.bungie.net/de/Application eine **eigene, zweite** Bungie-App an. Die App der Desktop-Version hat schon eine andere Redirect-URL, und Bungie erlaubt pro App nur eine.

- **OAuth Client Type:** `Confidential`
- **Redirect URL:** die genaue Adresse der Web-App, z.B. `https://<name>.github.io/<repo>/`
- **Origin Header:** nur der Ursprung, z.B. `https://<name>.github.io`
- **Scope:** „Read your Destiny 2 information“ und „Move or equip Destiny gear“

API Key, client_id und client_secret trägst du in der App unter **Setup** ein und meldest dich dann an. Die Seite zeigt dir dort auch die passende Redirect-URL und den Origin an.

## 3. Aufs iPhone

1. Die Adresse in **Safari** öffnen.
2. Teilen → **Zum Home-Bildschirm** antippen.
3. Die App vom Homescreen starten und unter **Setup** einrichten.

Beim ersten Start lädt die App Bungies Spieldaten und die Godroll-Wishlist herunter, etwa 90 MB. Am besten im WLAN. Danach liegen sie auf dem Gerät und werden automatisch aktualisiert, sobald Bungie neue Spieldaten veröffentlicht.

## Gut zu wissen

- **Speicherort:** Zugangsdaten und Login bleiben nur in diesem Browser auf diesem Gerät, im localStorage. Das macht DIM genauso.
- **Synchronisation:** Loadouts, Transmog-Sets und Shortcuts gleichen sich nicht automatisch mit der Desktop-App ab. Loadouts lassen sich aber über „DIM-Link kopieren“ und „Importieren“ übertragen.
- **Aktualisierung:** Das Inventar lädt alle 60 Sekunden neu, solange die App offen ist, und sofort beim Zurückwechseln in die App.
- **Test:** `node test.mjs` prüft den App-Kern ohne Netz und ohne Bungie-Konto.

## Dateien

- `index.html`: Oberfläche, dieselbe wie in der Desktop-App, mit Tab-Leiste unten fürs Handy
- `app.mjs`: Start, Speicher (localStorage und IndexedDB), Rückkehr vom Bungie-Login
- `core.mjs`: App-Logik, entspricht dem PC-Server der Desktop-App, läuft hier im Browser
- `data.mjs`, `inventory.mjs`, `bungie.mjs`: Spieldaten, Inventar, Bungie-API, übernommen aus der Desktop-App
- `sw.js`, `manifest.webmanifest`, `icon-*.png`: Offline-Start und Homescreen-Icon
