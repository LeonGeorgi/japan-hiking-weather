import mountainData from './gsi-mountains.json'

interface Mountain {
  id: number
  name: string
  reading: string
  elevation: number
  prefecture: string
  position: [latitude: number, longitude: number]
}

export const mountains: Mountain[] = mountainData.features.map(
  ({ properties, geometry }) => ({
    id: properties['連番'],
    name: properties['山名＜山頂名＞'],
    reading: properties['山名よみ＜山頂名よみ＞'],
    elevation: properties['標高値(m)'],
    prefecture: properties['都道府県'],
    // GeoJSON stores longitude first; Leaflet expects latitude first.
    position: [geometry.coordinates[1], geometry.coordinates[0]],
  }),
)
