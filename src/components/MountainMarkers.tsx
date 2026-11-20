import { CircleMarker, LayerGroup, Popup, Tooltip } from 'react-leaflet'
import { mountains } from '../data/mountains'

const markerStyle = {
  color: '#fff',
  weight: 1,
  fillColor: '#c2410c',
  fillOpacity: 0.9,
}

export default function MountainMarkers() {
  return (
    <LayerGroup attribution='Bergdaten: <a href="https://web2.gsi.go.jp/kihonjohochousa/kihonjohochousa41139.html">GSI</a>'>
      {mountains.map((mountain) => (
        <CircleMarker
          key={mountain.id}
          center={mountain.position}
          radius={4}
          pathOptions={markerStyle}
        >
          <Tooltip>{mountain.name}</Tooltip>
          <Popup>
            <strong lang="ja">{mountain.name}</strong>
            <br />
            <span lang="ja">{mountain.reading}</span>
            <br />
            {mountain.elevation.toLocaleString('de-DE')} m
            <br />
            <span lang="ja">{mountain.prefecture}</span>
          </Popup>
        </CircleMarker>
      ))}
    </LayerGroup>
  )
}
