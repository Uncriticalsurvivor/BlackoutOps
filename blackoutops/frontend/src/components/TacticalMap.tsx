/**
 * TacticalMap — Leaflet map with scenario markers.
 * Uses OpenStreetMap tiles (free, no API key).
 */

import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { ScenarioMap, MapMarker } from '../types';

// Fix Leaflet's default icon path issue with Vite
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function makeColoredIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `
      <div style="
        width:14px;height:14px;
        border-radius:50%;
        background:${color};
        border:2px solid #fff;
        box-shadow:0 0 6px ${color}88;
      "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });
}

function SetView({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  map.setView(center, zoom);
  return null;
}

interface Props {
  mapData: ScenarioMap;
}

export function TacticalMap({ mapData }: Props) {
  return (
    <MapContainer
      center={mapData.center}
      zoom={mapData.zoom}
      style={{ height: '100%', width: '100%', background: '#1a1a2e' }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="map-tiles-dark"
      />
      <SetView center={mapData.center} zoom={mapData.zoom} />
      {mapData.markers.map((m: MapMarker) => (
        <Marker
          key={m.id}
          position={m.latlng}
          icon={makeColoredIcon(m.color)}
        >
          <Popup>
            <div style={{ fontFamily: 'monospace', minWidth: 120 }}>
              <strong style={{ color: m.color }}>{m.label}</strong>
              <br />
              <small style={{ color: '#666' }}>
                {m.latlng[0].toFixed(4)}, {m.latlng[1].toFixed(4)}
              </small>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
