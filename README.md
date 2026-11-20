# Hiking Weather

Japan-Karte mit Vite, React, TypeScript und CSS Modules. Zeigt GSI-Gipfel,
Nationalparkgrenzen und ECMWF-IFS-Vorhersagen mit einem Wanderwert an den Bergmarkern.

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
maximalen Wind und maximale Böen pro Tag. Zusätzlich werden Stundenwerte für das
Wanderzeitfenster zusammengefasst. Wettercodes werden von Open-Meteo aus
Modellvariablen abgeleitet. Die Markerfarbe zeigt den Wanderwert, das Popup die
Teilbewertungen und die Tagesvorhersage.

Der Abruf erfolgt in Paketen mit 50 Orten und mindestens 12 Sekunden Abstand.
Temporäre Serverfehler werden wiederholt; bei Rate-Limits wird `Retry-After`
beachtet. Mit 16 angeforderten Variablen zählt ein vollständiger Lauf beim Anbieter
etwa 1.695 gewichtete Ortsabfragen; der Abstand berücksichtigt diese Gewichtung.
Die freie API ist für nichtkommerzielle Nutzung vorgesehen und hat Abruflimits:
[Bedingungen](https://open-meteo.com/en/terms),
[ECMWF-API](https://open-meteo.com/en/docs/ecmwf-api).

Die erzeugten Wetterdaten sind in Git ignoriert. Erst nach vollständiger Prüfung
wird die lokale Datei atomar ersetzt. Bei Fehlern bleibt die bisherige Datei
erhalten. Die Sidebar zeigt den Abrufzeitpunkt (nicht die Modelllaufzeit) und
kennzeichnet Daten, die älter als 18 Stunden sind oder den heutigen Tag nicht
mehr abdecken. Im Browser wird die statische Datei beim Öffnen, bei erneutem
Fokus und alle 30 Minuten geprüft.

## Wanderwert

Der Wert von 0 bis 100 ist eine eigene, noch nicht empirisch kalibrierte Heuristik
für Bergwanderungen auf markierten Wegen ohne Winterausrüstung. Er beschreibt
das Wetter am Gipfel, keine Freigabe oder Sicherheitsbewertung einer Route.
Altschnee, Lawinen, Wegzustand, Sperrungen, Vulkanwarnungen und persönliche
Voraussetzungen werden nicht bewertet. Die Schwellen sind keine amtlichen
Warnschwellen. Gewitterhinweise stammen aus dem abgeleiteten Modell-Wettercode;
das Fehlen eines solchen Codes bedeutet keine Gewitterfreiheit.

Berechnet wird das gewichtete geometrische Mittel aus vier Teilwerten (0–100):

```text
Wanderwert = Wind^0,35 × Niederschlag^0,35 × Temperatur^0,20 × Sicht^0,10
```

Ein Teilwert von 0 setzt den Gesamtwert auf 0; es wird kein Epsilon addiert.
Fehlende erforderliche Werte ergeben „Nicht bewertbar“, auch wenn andere
Teilwerte vorhanden sind. Gerundet wird erst der Gesamtwert; positive Werte
werden als mindestens 1 dargestellt. Farben und Bezeichnungen verwenden diesen
gerundeten Wert: 80–100 sehr günstig, 60–79 günstig, 40–59 gemischt, 20–39
ungünstig, 0–19 sehr ungünstig. Das Popup zeigt die zugrunde liegenden Messgrößen
und Teilwerte mit höchstens einer Nachkommastelle; positive Teilwerte unter
0,1 werden als „< 0,1“ angezeigt, damit nur echte Nullwerte als 0 erscheinen.
Ältere Wetterdateien ohne Stundenwerte bleiben lesbar und zeigen
bis zum nächsten Abruf keine Gesamtbewertung.

Die Auswertung verwendet vollständige Stundenintervalle zwischen **08 und 16 Uhr
JST**, deren Anfang und Ende laut Modell bei Tageslicht liegen. Niederschlag um
09 Uhr gehört zum Intervall 08–09 Uhr; nächtlicher Niederschlag wird nicht
mitgezählt. Wind, Böen, gefühlte Temperatur und Sicht werden an allen Endpunkten
dieser Intervalle geprüft. Über das Fenster werden die ungünstigsten Werte,
die Niederschlagssumme und die stärkste Niederschlagsstunde verwendet. Die
Stundenreihen werden beim Abruf zusammengefasst, nicht vollständig an den
Browser ausgeliefert. Tagesvorhersagen im Popup beziehen sich weiterhin auf
den ganzen Kalendertag.

Zwischen den folgenden Stützpunkten wird linear interpoliert; außerhalb gelten
die jeweiligen Randwerte. Format: `Wetterwert → Punkte`.

| Teilgröße | Einheit | Stützpunkte |
| --- | --- | --- |
| Wind, Maximum | km/h | 10→100, 20→80, 30→50, 40→20, 50→0 |
| Böen, Maximum | km/h | 20→100, 35→80, 50→50, 65→20, 80→0 |
| Niederschlag, Summe im Fenster | mm | 0,2→100, 1→85, 3→65, 8→40, 15→10, 25→0 |
| Niederschlag, stärkste Stunde | mm | 0,1→100, 0,5→85, 1→65, 2→40, 5→10, 10→0 |
| Gefühlte Temperatur | °C | −20→0, −10→25, 0→65, 10→100, 20→100, 25→80, 30→40, 35→0 |
| Sicht, Minimum | m | 50→0, 200→10, 1.000→50, 5.000→85, 10.000→100 |

Der Windwert ist das Minimum aus Wind- und Böenbewertung. Der Niederschlagswert
ist das Minimum aus Summen- und Intensitätsbewertung. Bei der Temperatur wird
das Minimum aus der Bewertung der niedrigsten und höchsten gefühlten Temperatur
verwendet. `apparent_temperature` kommt von Open-Meteo und ist weder UTCI noch
WBGT. Bei mehr als 0,2 mm Niederschlag und einer Lufttemperatur von höchstens
5 °C im Fenster wird der Temperaturwert wegen nasskalter Bedingungen mit 0,7
multipliziert.

Mindestens 0,1 cm Neuschnee oder Wettercodes für Schnee (71, 73, 75, 77, 85, 86),
gefrierenden Niederschlag (56, 57, 66, 67) oder Gewitter (95, 96, 97, 99) setzen
den Niederschlagswert für dieses Wanderprofil auf 0 und erscheinen als Hinweis.
Die Rohdaten bleiben im Popup sichtbar.

## Build und Prüfung

```sh
npm test        # Datumsgrenzen, Datenvertrag, API-Fehler und atomare Aktualisierung
npm run build   # TypeScript prüfen und Produktionsbuild erstellen
npm run lint    # Code mit Oxlint prüfen
npm run preview # Produktionsbuild lokal ansehen
```

## Mit GitHub Actions veröffentlichen

Die Seite wird unter [hiking.leongeorgi.de](https://hiking.leongeorgi.de/)
über GitHub Pages veröffentlicht. Im Repository
[LeonGeorgi/japan-hiking-weather](https://github.com/LeonGeorgi/japan-hiking-weather)
ist **GitHub Actions** als Pages-Quelle und `hiking.leongeorgi.de` als eigene
Domain eingestellt. Cloudflare verwaltet dafür einen DNS-only-CNAME von
`hiking.leongeorgi.de` auf `leongeorgi.github.io`.

Der Workflow `.github/workflows/weather-pages.yml` holt die Wetterdaten, prüft und
baut die Anwendung und veröffentlicht das Ergebnis. Eine Veröffentlichung lässt
sich unter **Actions → Update weather and publish → Run workflow** manuell starten.

Automatisch laufen Abruf, Tests, Build und Veröffentlichung auf GitHub Pages alle
sechs Stunden: 05:23, 11:23, 17:23 und 23:23 Uhr japanischer Zeit. GitHub kann
geplante Läufe verzögert starten. Zusätzliche Veröffentlichungen lassen sich
manuell auslösen. Ein Push allein startet keinen zusätzlichen Wetterabruf.

Der Build übernimmt den Basispfad aus der Pages-Konfiguration: bei der eigenen
Domain `/`, bei einer GitHub-Projektadresse den jeweiligen Projektpfad. Code und
Wetterdatei werden zusammen als Pages-Artefakt veröffentlicht. Die Wetterdatei
wird nicht ins Repository zurückcommittet. Schlägt Abruf, Prüfung oder Build fehl,
findet keine neue Veröffentlichung statt; der bisherige Stand bleibt erreichbar.
Zusätzliche API-Keys oder persönliche GitHub-Tokens sind nicht erforderlich.

Die Quellen und Aufbereitung der geografischen Daten stehen in `src/data/README.md`.
