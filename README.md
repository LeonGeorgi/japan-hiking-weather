# Hiking Weather

Japan-Karte mit Vite, React, TypeScript und CSS Modules. Zeigt GSI-Gipfel,
Nationalparkgrenzen und Vorhersagen von JMA MSM (5 km) und ECMWF IFS (9 km)
mit einem Wanderwert als Farbfläche.
Neutrale Bergsymbole erscheinen ab Zoomstufe 8 und öffnen die individuellen Gipfelvorhersagen.
Verschieben und Herauszoomen sind auf Japan samt Inseln begrenzt; die minimale
Zoomstufe passt sich an die Fenstergröße an.

## Entwicklung

Voraussetzungen: Node.js 24 oder neuer und [uv](https://docs.astral.sh/uv/getting-started/installation/).
`uv` stellt Python 3.13 und die festgelegten Import-Abhängigkeiten bereit.

```sh
npm ci
npm run weather:update
npm run dev
```

Der erste Wetterabruf dauert einige Minuten und benötigt Internetzugriff.
Die Anwendung liest anschließend die lokale Datei `public/weather/forecast.json`
und die darin referenzierten vorberechneten Wetter-Bildkacheln.
Ein Wechsel des Vorhersagetags löst keinen Abruf beim Wetteranbieter aus.

## Wetter aktualisieren

```sh
npm run weather:update
```

Der gleiche Befehl läuft lokal und in GitHub Actions. Er lädt native IFS- und
MSM-Modelldateien aus [Open-Meteos öffentlichem S3-Datensatz](https://github.com/open-meteo/open-data)
und berechnet daraus sowohl die Farbfläche als auch sieben Tage für alle
1.059 GSI-Gipfel. **Es gibt keine Abfragen der Open-Meteo-Punkt-API mehr.**
Weiterhin nötig sind HTTP-Teilabrufe der komprimierten Modelldateien und deren
Metadaten. API-Key und AWS-Konto sind nicht erforderlich.

Die Gipfel verwenden dieselben Modellläufe wie die jeweilige Fläche:
kurzfristig JMA MSM (ca. 5 km), danach ECMWF IFS (ca. 9 km). Für jeden Gipfel wird
unter benachbarten Modellzellen eine geeignete Landzelle ausgewählt. Dabei werden
Entfernung und Ähnlichkeit der Geländehöhe berücksichtigt. Fehlt eine Landzelle,
kann wie beim Anbieter eine nahe Meereszelle mit Modellhöhe 0 m verwendet werden.

Die statischen Modellhöhen (`HSURF.om`) werden in `.cache/ecmwf/static/` gespeichert
und nur bei geänderter S3-ETag neu geladen. Die Temperatur wird **vor** der
Berechnung von gefühlter Temperatur, Wettercode und Wanderwert stündlich auf die
GSI-Gipfelhöhe korrigiert:

```text
T_Gipfel = T_Modell - 0,0065 × (H_Gipfel - H_Modell)
```

Höhen in Metern, Temperaturen in °C. Dieselbe Korrektur gilt bei IFS auch für den
Taupunkt. Bei MSM werden Taupunkt und Schneeanteil aus der korrigierten Temperatur
und der nativen relativen Feuchte abgeleitet. Wind und Niederschlagsmenge bleiben
Modellwerte. Die feste Temperaturabnahme von 0,65 °C pro 100 m entspricht
[Open-Meteos Höhenkorrektur](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Helper/Reader/GenericReader.swift);
sie bildet keine lokale Inversion oder Hang-/Kammeffekte ab.

Die Datei enthält Temperaturminimum und -maximum, Niederschlag, Neuschnee,
maximalen Wind, maximale Böen und die Zusammenfassung des Wanderzeitfensters.
Tagesminimum und -maximum verwenden die Momentanwerte von 00 bis 23 Uhr JST.
Niederschlag und Schnee verwenden die 24 vollständigen Stundenintervalle von
00 bis 24 Uhr; ein um 00 Uhr endendes Intervall gehört zum Vortag. Tageswerte und
Wanderwerte werden getrennt aggregiert.

Ein gewählter MSM-Lauf muss das gesamte Wanderzeitfenster abdecken. Fehlende
Randstunden des Kalendertags werden für die Tagesvorhersage aus den bereits
höhenkorrigierten IFS-Werten ergänzt und im Popup kenntlich gemacht. Das
Wanderzeitfenster verwendet dabei vollständig MSM. Ohne vollständigen MSM-Lauf
bleibt der Tag bei IFS. Böen, Sicht und Gewitterhinweise werden weiterhin aus IFS
ergänzt. Schnee- und Wettercodes werden lokal aus den verfügbaren Feldern
abgeleitet; sie können von der bisherigen Punkt-API abweichen. Nicht vorhandene
Eingaben bleiben unbekannt und ergeben keine vollständige Bewertung.

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
verwendet. Die gefühlte Temperatur wird lokal nach Open-Meteos Formel berechnet;
sie ist weder UTCI noch WBGT. Bei mehr als 0,2 mm Niederschlag und einer Lufttemperatur von höchstens
5 °C im Fenster wird der Temperaturwert wegen nasskalter Bedingungen mit 0,7
multipliziert.

Mindestens 0,1 cm Neuschnee oder Wettercodes für Schnee (71, 73, 75, 77, 85, 86),
gefrierenden Niederschlag (56, 57, 66, 67) oder Gewitter (95, 96, 97, 99) setzen
den Niederschlagswert für dieses Wanderprofil auf 0 und erscheinen als Hinweis.
Die Rohdaten bleiben im Popup sichtbar.

## Flächige Darstellung

Die Farbfläche verwendet ein **höhenkorrigiertes Raster von ungefähr 250 m**.
GSI-DEM10B-Höhentiles liefern die Geländehöhe jedes Bildpunkts. Sie werden bei
Web-Mercator-Zoomstufe 9 gelesen; die tatsächliche Pixelbreite liegt in unserem
Japan-Ausschnitt je nach Breite bei ungefähr 210–280 m. Die Höhentiles sind aus
dem 10-m-Geländemodell abgeleitet und auf dieser Zoomstufe räumlich gemittelt;
ein schmaler Gipfel kann deshalb unter seiner GSI-Punkthöhe liegen.
Wo DEM10B fehlt, wird GSI DEMGM (ca. 500 m) verwendet. Ohne gültige Höhe bleibt
der Bildpunkt transparent. [GSI-Höhentiles](https://maps.gsi.go.jp/development/demtile.html),
[Datensätze und Auflösungen](https://maps.gsi.go.jp/development/ichiran.html).

Für jeden Landpixel wird mit derselben Zellenauswahl und Höhenkorrektur wie bei
den Gipfeln eine stündliche Vorhersage berechnet. Erst danach werden gefühlte
Temperatur, MSM-Schneeanteil, Wanderfenster und Score berechnet. Die Scores werden
nicht nachträglich um einen Höhenfaktor verändert. GSI-Höhen und die japanische
Landmaske werden unter `.cache/terrain/` vorbereitet und wiederverwendet.

Die Wetterinformation stammt kurzfristig aus **176.841 nativen MSM-Modellzellen** im
Japan-Ausschnitt von 24 bis 46 °N und 122 bis 147 °E, einschließlich Meer.
Das MSM-Gitter hat 0,05° Breiten- und 0,0625° Längenabstand (ca. 5 km).
Für spätere Tage bleiben **68.433 native IFS-O1280-Zellen** (ca. 9 km).
Beide werden als Rasterzeilen von Norden nach Süden gespeichert; bei IFS
variieren ihre Länge und der Längengradabstand mit der Breite.
Die Fläche wird nicht aus Gipfelvorhersagen abgeleitet. Die feinen Farben
berücksichtigen die örtliche Höhe; Wind, Niederschlagsmenge und andere lokale
Wetterstrukturen haben weiterhin die Auflösung des Wettermodells. Ein feineres
Höhenraster erzeugt keine zusätzlichen Informationen über kleine Regenschauer,
Inversionen oder Windverstärkung am Grat.

Der Python-Import lädt ausschließlich benötigte komprimierte Dateiblöcke aus
[Open-Meteos öffentlichem S3-Datensatz](https://github.com/open-meteo/open-data).
Weder API-Key noch AWS-Konto sind nötig. Für IFS verwendet er die neuesten
00-/12-UTC-Läufe, die das jeweilige Wanderfenster vollständig abdecken. Beginnt
der neueste Lauf erst nach dem heutigen Morgen, wird für heute der vorherige
Lauf verwendet, für spätere Tage der neueste. Die Modelllaufzeit des ausgewählten
Tages steht in der Sidebar.

Für MSM werden die neuesten verfügbaren 3-Stunden-Läufe geprüft. Pro Tag wird
der neueste Lauf verwendet, der 08–16 Uhr JST vollständig abdeckt, einschließlich
des vorherigen Intervalls. Ein älterer langer MSM-Lauf kann dadurch für Tag drei
gewählt werden, wenn der neueste kürzere Lauf nicht weit genug reicht.
Außerhalb dieser Reichweite wird IFS angezeigt. Es werden keine fehlenden
MSM-Stunden mit gutem Wetter aufgefüllt.

Die sieben MSM-Rohfelder sind Temperatur, relative Feuchte, beide Windkomponenten,
Niederschlag, Bewölkung und Sonneneinstrahlung. Sie werden stündlich übernommen.
Taupunkt und gefühlte Temperatur werden daraus berechnet. Wie in der JMA-API
zählt Niederschlag unter 0 °C als Schnee (0,7 cm pro mm). Böen, minimale Sicht
und Gewitterhinweise stammen aus einer für den Ort und seine Höhe ausgewählten
IFS-Zelle desselben Tages;
**diese Ergänzungen haben weiterhin ca. 9 km Auflösung**. Fehlen die nötigen
IFS-Eingaben, erhält die MSM-Zelle keine vollständige Bewertung.

Die zwölf IFS-Rohfelder sind Temperatur, Taupunkt, Windkomponenten, Böen,
Niederschlag, Schneewasseräquivalent, Sicht, Bewölkung, CAPE, Schauer und
Sonneneinstrahlung. Jeder Datensatz verwendet seine eigene eingebettete
Zeitachse. Niederschlagssummen werden konservierend auf ihre Stundenintervalle
verteilt; Böenmaxima werden für das gesamte native Intervall übernommen.
Momentanwerte werden zeitlich linear interpoliert. Die native Zeitauflösung
beträgt zunächst eine, später drei bzw. sechs Stunden. Die Verteilung stellt
keine tatsächlich bekannte stündliche Niederschlagsspitze wieder her.

Die gefühlte Temperatur folgt der
[Open-Meteo-Formel](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Helper/Meteorology.swift).
Tageslicht wird mit den
[NOAA-Sonnenstandsformeln](https://gml.noaa.gov/grad/solcalc/solareqns.PDF) ermittelt.
Schneewasser wird mit 0,7 cm pro mm in Neuschnee umgerechnet. Für die Bewertung
werden Schnee- und Gewitterhinweise aus den Rohfeldern abgeleitet; der
[Open-Meteo-Gewitterindikator](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Helper/WeatherCode.swift)
verwendet hier CAPE, Schauer/Regen, Bewölkung, Böen und Breite. Die optionalen
CIN-/Grenzschichthöhenfelder und ein separates Gefrierregenfeld werden in diesem
Import nicht ausgewertet. Die Flächenwerte sind deshalb keine exakte Kopie der
abgeleiteten Wettercodes der Punkt-API.

Python fasst das Wanderfenster zusammen. Ein persistenter TypeScript-Prozess
berechnet über eine binäre Pipe mit **derselben Bewertungsfunktion wie die
Gipfel-Popups** den Tageswert jedes Pixels. Auch die Farben kommen aus derselben
Legende: beispielsweise sind alle Scores von 40 bis 59 gelb.

Veröffentlicht werden PNG-Kacheln der Zoomstufen 5–9 für jeden Tag. Leaflet lädt
nur die sichtbaren Kacheln und vergrößert sie beim Hineinzoomen ohne Glättung.
Die Übersichtskacheln verwenden ebenfalls die nächste Nachbarzelle, keine
Mischung der Scores. Die Landmaske aus geoBoundaries/MLIT ist bereits in die
Transparenz eingerechnet; nur die Küstenkante wird geglättet. Meer und
Nachbarländer bleiben transparent. Details zur Maske stehen in `src/data/README.md`.
Gipfelsymbole, Parkgrenzen und der Regler für die Farbstärke bleiben erhalten.

`forecast.json` enthält Gipfelwerte, Modellläufe, native IFS-/MSM-Byte-Raster
und die Metadaten der Bildkacheln. Ältere Wetterdateien ohne Höhenkacheln zeigen
weiterhin das native Raster. Rohstunden und Rohwetterfelder bleiben im
ignorierten Verzeichnis `.cache/ecmwf/`.

`npm run weather:update` aktualisiert Gipfel und Raster gemeinsam aus denselben
Rohdaten. Die Kacheln werden zuerst unter einer neuen Generations-ID abgelegt,
anschließend wird `forecast.json` nach erfolgreicher Prüfung atomar ersetzt.
Ein fehlgeschlagener Import verändert den bisherigen Datensatz nicht.
Der frühere separate Befehl `weather:grid` entfällt. Ein erneuter Abruf desselben
Laufs verwendet den lokalen Rohdatencache.

Der frühere Downloadtest ist unter `experiments/ecmwf-download/` dokumentiert.
Seine lokalen `.npz`-Dateien lassen sich für einen passenden Lauf optional über
`ECMWF_SEED_CACHE=/absoluter/pfad/zum/testverzeichnis` wiederverwenden. Bei einem
neuen Lauf werden neue Daten geladen. Je nach benötigten Modellläufen kann der
Import mehr als einen Ausschnitt abrufen.

## Code-Struktur

`src/weather/config.json` ist die gemeinsame Konfiguration für TypeScript und
Python: Vorhersagedauer, Zeitzone, Wanderzeitfenster, Rastergrenzen und das
binäre Austauschformat. `config.ts` und `scripts/weather_config.py` lesen sie
für die jeweilige Laufzeit. `scripts/weather-native.ts` prüft das Importmanifest
und liest benannte Messgrößen. Ihre Validierung nutzt dasselbe Wetterschema
wie die veröffentlichten Daten; die Reihenfolge der Float32-Felder steht in
der gemeinsamen Konfiguration.
`scripts/update-weather-native.py` führt den Rohdatenimport für Flächen und
Gipfel zusammen. `scripts/weather_calculations.py` enthält die gemeinsame
Meteorologie, Zellenauswahl, Höhenkorrektur und Tagesaggregation.
`scripts/jma_msm.py` übernimmt die MSM-Rasterdefinition, Laufwahl und Rohdaten.
`scripts/terrain_surface.py` lädt und speichert GSI-Höhen, beschneidet die Fläche
auf Japan und schreibt die Wetterkacheln. `scripts/score-weather.ts` bewertet
ihre Stunden-Zusammenfassungen mit der gemeinsamen TypeScript-Scorefunktion.
Nach Änderungen am Zeitfenster oder Datenformat werden die Wetterdateien mit
`npm run weather:update` neu erzeugt.

`WeatherSurface.tsx` lädt die vorberechneten Wetterkacheln als Leaflet-Ebene.
Für ältere Wetterdateien verwendet die Komponente `useJapanLand.ts`,
`render-surface.ts` und `land-mask.ts` zur Darstellung des nativen Rasters.

## Build und Prüfung

```sh
npm test        # Datenvertrag, Bewertung, nativer Import und atomare Aktualisierung
npm run test:weather-import # Laufwahl, Höhenkorrektur, Tagesgrenzen und Meteorologie
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

Der Workflow `.github/workflows/weather-pages.yml` richtet uv/Python ein,
speichert die statischen GSI- und Modellhöhen im Actions-Cache, holt die Wetterdaten, prüft und
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
