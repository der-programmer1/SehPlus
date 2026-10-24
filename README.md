# SehPlus Web/PWA

Die Web-Version ist eine buildless, lokale PWA für Safari, Chrome und andere moderne Browser.

## Lokal testen

Im Ordner `web` einen HTTPS-Static-Server verwenden. Für die Kamera reicht `localhost`; für ein echtes Smartphone muss die Seite über HTTPS erreichbar sein.

```bash
cd web
python3 -m http.server 8080
```

Ohne HTTPS funktioniert die Kamera nur in lokalen Entwicklungsumgebungen wie `localhost`.

## GitHub Pages

Der Workflow unter `.github/workflows/deploy-pages.yml` veröffentlicht den Inhalt dieses Ordners automatisch bei jedem Push auf `main`. Im Repository müssen unter **Settings → Pages** die GitHub-Actions als Quelle ausgewählt werden.

Vor der Veröffentlichung:

1. `CONFIG.feedbackUrl` in `app.js` durch den echten Google-Forms-Antwortlink ersetzen.
2. `CONFIG.donationUrl` durch die eigene Spendenadresse ersetzen.
3. Datenschutz, Impressum und Kontakt auf der About-Seite beziehungsweise als eigene Seiten ergänzen.
4. Die PWA auf iPhone-Safari und mindestens einem Android-Chrome-Gerät testen.

Kamera-, Bild- und Pipettendaten werden nur im Browser verarbeitet. Es gibt keinen Server und keinen automatischen Upload.
