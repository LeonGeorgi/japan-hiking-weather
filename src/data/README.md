# Kartendaten

## Relief-Grundkarte (GSI)

Die Grundkarte besteht ausschließlich aus der grauen GSI-Schummerung
`hillshademap`. Sie wird mit voller Deckkraft und ohne Farbfilter oder
Mischmodus angezeigt. Wetterfarben, Bergsymbole und Nationalparkgrenzen liegen
darüber. Eine zusätzliche Straßenkarte wird nicht geladen.

- [GSI-Kartenebenen und Nutzungsbedingungen](https://maps.gsi.go.jp/development/ichiran.html)
- Grundkarte: `https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png`

Die Karte lässt sich nur innerhalb des Japan-Ausschnitts von 20 bis 46 °N und
122 bis 154 °E verschieben, einschließlich der vorgelagerten Inseln. Die
kleinste Zoomstufe wird an die Fenstergröße angepasst (mindestens Zoom 5),
sodass der sichtbare Kartenausschnitt innerhalb dieses Bereichs bleibt.
Die GSI-Schummerung liefert native Kacheln von Zoom 2 bis 16 und wird darüber
bis zur maximalen Karten-Zoomstufe 19 vergrößert. Weltkopien sind deaktiviert.
Fehlende Kacheln werden transparent vor dem neutralen Kartenhintergrund
angezeigt. Die Quellenangabe verlinkt den GSI-Kartenkatalog.

## Landmaske für die Wetterfläche

`japan-land.json` enthält die aufbereiteten Japan-ADM0-Polygone von
[geoBoundaries](https://www.geoboundaries.org/). Die Metadaten nennen als
Originalquelle das japanische Ministry of Land, Infrastructure, Transport and
Tourism (MLIT), National Land Numerical Information, Verwaltungsgrenzen N03.
Dargestellter Datenstand: 2022; geoBoundaries-Build vom 12. Dezember 2023.
Heruntergeladen am 22. November 2026.

- [Metadaten/API](https://www.geoboundaries.org/api/current/gbOpen/JPN/ADM0/)
- [Verwendetes Original-GeoJSON, Release 9469f09](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/JPN/ADM0/geoBoundaries-JPN-ADM0.geojson)
- [Lizenz: CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- [MLIT-Quelldatensatz](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v3_1.html)

SHA-256 des Original-GeoJSON:
`8da994e4c3301fa3f2e51dcbc23025d61225e6c15ed9c85e4a063ebc1cd11af8`.

Die Aufbereitung repariert ungültige Geometrien, vereinfacht in Web Mercator
mit 10 Metern Toleranz und erhält die Topologie. Anschließend werden die
WGS84-Koordinaten auf sieben Nachkommastellen gerastert. Alle **4.979 Teilflächen**
bleiben erhalten; es gibt keinen Größenfilter für kleine Inseln. Das Ergebnis
enthält 153.815 Stützpunkte. Der Import prüft Land- und Inselorte sowie Meer,
Buchten und Nachbarländer an 16 Kontrollpunkten.

Die Maske wird als SVG-Clipping-Pfad in derselben Web-Mercator-Projektion wie
die Wetterfläche gezeichnet. Küsten und Innenringe bleiben dadurch unabhängig
von der Wetterbild-Auflösung. Außerhalb der Japan-Polygone ist die Wetterebene
transparent; es wird keine Meeresfläche mit einer Hintergrundfarbe übermalt.
Die Einfärbung reicht weiterhin nur so weit wie die vorhandenen Wetterdaten.
Die lokalen Daten werden mit der Anwendung veröffentlicht; zur Laufzeit wird
keine externe Grenzdaten-API abgefragt. Die Quellenangabe auf der Karte verlinkt
geoBoundaries und kennzeichnet die Aufbereitung.

Erneut erzeugen:

```sh
curl -fL https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/JPN/ADM0/geoBoundaries-JPN-ADM0.geojson -o /tmp/geoboundaries-japan.geojson
uv run --python 3.13 scripts/import-japan-land.py /tmp/geoboundaries-japan.geojson
```

## GSI-Bergdaten

`gsi-mountains.json` enthält die unveränderte GeoJSON-Datei
`1003zan20260331.geojson` der Geospatial Information Authority of Japan (GSI),
Ausgabe vom 31. März 2026. Heruntergeladen am 20. November 2026.

- [Datensatz: 日本の主な山岳標高（１００３山）](https://web2.gsi.go.jp/kihonjohochousa/kihonjohochousa41139.html)
- [Original-Download (ZIP)](https://www.gsi.go.jp/KOKUJYOHO/MOUNTAIN/1003zan20260331.zip)
- [GSI-Nutzungsbedingungen (PDL 1.0)](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)

Die 1.003 Berge umfassen 1.059 einzelne Gipfelpunkte. Alle Punkte werden übernommen,
einschließlich mehrerer Gipfel desselben Bergs. Die GSI-Seriennummer (`連番`) dient
als eindeutige ID; gleichnamige Berge werden nicht zusammengefasst.

Das GeoJSON weist JGD2011 (EPSG:6668) als Koordinatensystem aus.
`mountains.ts` übernimmt die ursprünglichen Koordinaten und Höhen und bildet die
japanischen Feldnamen auf die Anwendungsstruktur ab. Für Leaflet wird die
Koordinatenreihenfolge von `[Längengrad, Breitengrad]` auf
`[Breitengrad, Längengrad]` getauscht. Die Darstellung als Kreismarker wird von
dieser Anwendung erzeugt. Die Quellenangabe erscheint direkt auf der Karte.

## Nationalparkgrenzen (Biodic / Umweltministerium Japan)

`biodic-national-parks.geojson` wird aus dem offiziellen landesweiten KML-Download
des Biodiversity Center of Japan, Ministry of the Environment, erzeugt:

- [Vom Nutzer genanntes GIS-Portal](https://www.biodic.go.jp/trialSystem/top_en.html)
- [KML-Downloadseite](https://www.biodic.go.jp/trialSystem/EN/kmlddl.html)
- [Landesweiter Nationalpark-Index](https://www.biodic.go.jp/trialSystem/EN/LinkEnt/nps/NPSAllLinkEnt.kml)
- [Originaldaten: NPS_all.kmz](https://www.biodic.go.jp/trialSystem/EN/Data/nps/NPS_all.kmz)
- [Nutzungsbedingungen](https://www.biodic.go.jp/copyright/index_e.html)

Heruntergeladen am 20. November 2026. Der Server meldet für die Quelldatei
`Last-Modified: 28. April 2025`; dies ist kein zugesicherter fachlicher Stichtag.
Die Datei enthält 15.293 Teilflächen für 35 Nationalparks, einschließlich
Hidakasanmyaku-Erimo-Tokachi. Die englischen Parknamen stammen aus den Originaldaten.

SHA-256 des Originalarchivs:
`3c180f26b20275b0c12884dc7a715778cbc10168ee7b5780fa5e280938b6c04e`.

Aufbereitung durch diese Anwendung:

- KML-Koordinaten in WGS84 (Längengrad, Breitengrad) übernehmen, einschließlich Inseln und Innenringen.
- Ungültige Ausgangspolygone reparieren (20 im verwendeten Download).
- Teilflächen nach Parkname vereinigen; interne Grenzen der Schutzzonen entfallen.
- In Web Mercator (EPSG:3857) mit 10 Metern Toleranz und Erhalt der Topologie vereinfachen.
- Nach WGS84 (EPSG:4326) zurücktransformieren und auf 7 Nachkommastellen rastern.

Die Umrisse sind für die Übersicht auf der Webkarte vereinfacht. Die Quellenangabe
auf der Karte kennzeichnet die Aufbereitung. Die originale KMZ-Datei mit rund
54 MB wird nicht im Repository mitgeführt.

Erneut erzeugen (benötigt [uv](https://docs.astral.sh/uv/)):

```sh
curl -fL https://www.biodic.go.jp/trialSystem/EN/Data/nps/NPS_all.kmz -o /tmp/NPS_all.kmz
uv run --python 3.13 scripts/import-national-parks.py /tmp/NPS_all.kmz
```

Shapely und PyProj werden nur für diesen Import benötigt. Die React-Anwendung
lädt das erzeugte GeoJSON als lokale statische Datei.
