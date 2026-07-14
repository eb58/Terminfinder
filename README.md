# Terminfinder

Schlanke Terminabstimmung für Gruppen – ohne Anmeldung, direkt im Browser. Gebaut mit Vanilla JS und PHP, kein Build-Schritt nötig.

## Funktionsweise

Jede Umfrage lebt unter einer eigenen URL, die sich aus einem frei wählbaren Namen zusammensetzt:

| URL | Rolle |
|-----|-------|
| `/Sommerfest*` | Admin-Ansicht – Termine und Teilnehmer bearbeiten |
| `/Sommerfest` | Teilnehmer-Ansicht – abstimmen |
| `/` | Startseite mit Erklärung und Formular zum Anlegen einer neuen Umfrage |

Der Stern am Ende der URL aktiviert den Admin-Modus. Den Admin-Link behält man für sich; den Link ohne Stern teilt man mit den Teilnehmern.

Sobald alle Teilnehmer abgestimmt haben, wird eine E-Mail-Benachrichtigung verschickt.

## Lokal testen

### Variante 1 – PHP-Entwicklungsserver (empfohlen)

Voraussetzung: PHP 8.x installiert.

```bash
php -S localhost:8000 router.php
```

Dann http://localhost:8000 im Browser öffnen.

Der `router.php` leitet alle Anfragen auf `index.html` um, damit die URL-basierte Navigation funktioniert – genauso wie `.htaccess` auf dem echten Server.

## Datenhaltung

Jede Umfrage wird als JSON-Datei unter `data/polls/<name>.json` gespeichert. Es gibt keine Datenbank.

## Deployment

Apache mit PHP 8.x. Das `.htaccess` aktiviert `mod_rewrite` und leitet alle Anfragen auf `index.html` um.

Die E-Mail-Benachrichtigung nutzt die PHP-Funktion `mail()` – ein korrekt konfigurierter MTA auf dem Server wird vorausgesetzt.
