# GSI-Bergdaten

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
