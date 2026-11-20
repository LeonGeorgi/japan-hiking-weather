# Hiking Weather

Japan-Karte mit Vite, React, TypeScript und CSS Modules. Zeigt GSI-Gipfel,
Nationalparkgrenzen und ECMWF-IFS-Tagesvorhersagen an den Bergmarkern.

## Entwicklung

Voraussetzung: Node.js 24 oder neuer.

```sh
npm ci
npm run weather:update
npm run dev
```

Der erste Wetterabruf dauert einige Minuten und benötigt Internetzugriff.
Die Anwendung liest anschließend nur die lokale Datei `public/weather/forecast.json`.
Ein Wechsel des Vorhersagetags löst keinen Abruf beim Wetteranbieter aus.

## Wetter aktualisieren

```sh
npm run weather:update
```

Der gleiche Befehl läuft lokal und in GitHub Actions. Er holt sieben Tage für alle
1.059 Gipfel von der öffentlichen Open-Meteo-ECMWF-API, explizit mit dem Modell
`ecmwf_ifs` (IFS HRES, ca. 9 km), ohne API-Key. Kalender und Tageswerte verwenden
`Asia/Tokyo`. Die GSI-Gipfelhöhe wird als `elevation` für die Temperaturkorrektur
übergeben. Wind, Wettercode und Niederschlag stammen aus dem Modellraster.

Die Datei enthält Temperaturminimum und -maximum, Niederschlag, Neuschnee,
maximalen Wind und maximale Böen pro Tag. Wettercodes werden von Open-Meteo aus
Modellvariablen abgeleitet. Die Markerfarbe zeigt den Wettertyp, das Popup die Werte.

Der Abruf erfolgt in Paketen mit 50 Orten und mindestens 7,5 Sekunden Abstand.
Temporäre Serverfehler werden wiederholt; bei Rate-Limits wird `Retry-After`
beachtet. Ein vollständiger Lauf zählt beim Anbieter etwa 1.059 Ortsabfragen.
Die freie API ist für nichtkommerzielle Nutzung vorgesehen und hat Abruflimits:
[Bedingungen](https://open-meteo.com/en/terms),
[ECMWF-API](https://open-meteo.com/en/docs/ecmwf-api).

Die erzeugten Wetterdaten sind in Git ignoriert. Erst nach vollständiger Prüfung
wird die lokale Datei atomar ersetzt. Bei Fehlern bleibt die bisherige Datei
erhalten. Die Sidebar zeigt den Abrufzeitpunkt (nicht die Modelllaufzeit) und
kennzeichnet Daten, die älter als 18 Stunden sind oder den heutigen Tag nicht
mehr abdecken. Im Browser wird die statische Datei beim Öffnen, bei erneutem
Fokus und alle 30 Minuten geprüft.

## Build und Prüfung

```sh
npm test        # Datumsgrenzen, Datenvertrag, API-Fehler und atomare Aktualisierung
npm run build   # TypeScript prüfen und Produktionsbuild erstellen
npm run lint    # Code mit Oxlint prüfen
npm run preview # Produktionsbuild lokal ansehen
```

## Später mit GitHub Actions veröffentlichen

Der Workflow `.github/workflows/weather-pages.yml` ist vorbereitet. Es wurde
noch keine GitHub-Verbindung oder Veröffentlichung eingerichtet.

1. Das Repository nach GitHub hochladen, mit dem Workflow auf dem Standardbranch.
2. Unter **Settings → Pages → Build and deployment → Source** die Option
   **GitHub Actions** wählen.
3. Unter **Actions → Update weather and publish → Run workflow** einmal starten.

Danach laufen Abruf, Tests, Build und Veröffentlichung auf GitHub Pages alle
sechs Stunden: 05:23, 11:23, 17:23 und 23:23 Uhr japanischer Zeit. GitHub kann
geplante Läufe verzögert starten. Zusätzliche Veröffentlichungen lassen sich
manuell auslösen. Ein Push allein startet keinen zusätzlichen Wetterabruf.

Der Build übernimmt den Projektpfad aus der Pages-Konfiguration, sodass auch
Adressen wie `https://<name>.github.io/hiking-weather/` funktionieren. Code und
Wetterdatei werden zusammen als Pages-Artefakt veröffentlicht. Die Wetterdatei
wird nicht ins Repository zurückcommittet. Schlägt Abruf, Prüfung oder Build fehl,
findet keine neue Veröffentlichung statt; der bisherige Stand bleibt erreichbar.
Zusätzliche API-Keys oder persönliche GitHub-Tokens sind nicht erforderlich.

Die Quellen und Aufbereitung der geografischen Daten stehen in `src/data/README.md`.
