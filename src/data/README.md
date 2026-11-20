# Kartendaten

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
