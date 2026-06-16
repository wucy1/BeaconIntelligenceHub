import L from 'leaflet';
import { useMemo } from 'react';
import { CircleMarker, Marker, Polygon, Polyline, useMapEvents } from 'react-leaflet';

import { edgeMidpoints, nearestEdgeInsert } from '../../ops/polygonEditUtils';
import type { LatLng } from '../../ops/polygonUtils';
import { normalizeLng } from '../../utils/mapBbox';

const VERTEX_ICON = L.divIcon({
  className: 'ops-vertex-handle',
  html: '<span></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const SELECTED_VERTEX_ICON = L.divIcon({
  className: 'ops-vertex-handle selected',
  html: '<span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

type Props = {
  vertices: LatLng[];
  closed: boolean;
  selectedVertex: number | null;
  onVerticesChange: (next: LatLng[]) => void;
  onSelectVertex: (index: number | null) => void;
  /** 繪製中：點地圖加頂點 */
  allowMapAdd?: boolean;
  /** 編輯中：點地圖在邊上插入頂點 */
  allowEdgeInsert?: boolean;
};

function MapVertexHandler({
  allowMapAdd,
  allowEdgeInsert,
  vertices,
  closed,
  onVerticesChange,
  onSelectVertex,
}: Pick<Props, 'allowMapAdd' | 'allowEdgeInsert' | 'vertices' | 'closed' | 'onVerticesChange' | 'onSelectVertex'>) {
  useMapEvents({
    click(e) {
      if (allowMapAdd) {
        onVerticesChange([
          ...vertices,
          { lat: e.latlng.lat, lng: normalizeLng(e.latlng.lng) },
        ]);
        onSelectVertex(vertices.length);
        return;
      }
      if (allowEdgeInsert && vertices.length >= 2) {
        const hit = nearestEdgeInsert(vertices, { lat: e.latlng.lat, lng: e.latlng.lng }, closed);
        if (hit && hit.distDeg < 0.008) {
          const next = [...vertices];
          next.splice(hit.insertAt, 0, hit.projected);
          onVerticesChange(next);
          onSelectVertex(hit.insertAt);
        }
      }
    },
  });
  return null;
}

function DraggableVertex({
  index,
  position,
  selected,
  onMove,
  onSelect,
}: {
  index: number;
  position: LatLng;
  selected: boolean;
  onMove: (index: number, pos: LatLng) => void;
  onSelect: (index: number) => void;
}) {
  return (
    <Marker
      position={[position.lat, position.lng]}
      icon={selected ? SELECTED_VERTEX_ICON : VERTEX_ICON}
      draggable
      zIndexOffset={1200}
      eventHandlers={{
        dragend: (ev) => {
          const ll = ev.target.getLatLng();
          onMove(index, { lat: ll.lat, lng: normalizeLng(ll.lng) });
        },
        click: (ev) => {
          L.DomEvent.stopPropagation(ev);
          onSelect(index);
        },
      }}
    />
  );
}

export function OpsPolygonEditor({
  vertices,
  closed,
  selectedVertex,
  onVerticesChange,
  onSelectVertex,
  allowMapAdd,
  allowEdgeInsert,
}: Props) {
  const positions = useMemo(
    () => vertices.map((v) => [v.lat, v.lng] as [number, number]),
    [vertices],
  );
  const midpoints = useMemo(() => edgeMidpoints(vertices, closed), [vertices, closed]);

  return (
    <>
      {(allowMapAdd || allowEdgeInsert) && (
        <MapVertexHandler
          allowMapAdd={allowMapAdd}
          allowEdgeInsert={allowEdgeInsert}
          vertices={vertices}
          closed={closed}
          onVerticesChange={onVerticesChange}
          onSelectVertex={onSelectVertex}
        />
      )}

      {vertices.length >= 2 && !closed && (
        <Polyline positions={positions} pathOptions={{ color: '#1565c0', weight: 2, dashArray: '6 4' }} />
      )}
      {closed && vertices.length >= 3 && (
        <Polygon positions={positions} pathOptions={{ color: '#1565c0', weight: 2, fillOpacity: 0.18 }} />
      )}

      {allowEdgeInsert &&
        midpoints.map((m) => (
          <CircleMarker
            key={`mid-${m.index}`}
            center={[m.lat, m.lng]}
            radius={6}
            pathOptions={{
              color: '#0d9488',
              fillColor: '#99f6e4',
              fillOpacity: 0.95,
              weight: 2,
            }}
            eventHandlers={{
              click: (ev) => {
                L.DomEvent.stopPropagation(ev);
                const next = [...vertices];
                next.splice(m.index, 0, { lat: m.lat, lng: m.lng });
                onVerticesChange(next);
                onSelectVertex(m.index);
              },
            }}
          />
        ))}

      {vertices.map((v, i) => (
        <DraggableVertex
          key={`v-${i}-${v.lat}-${v.lng}`}
          index={i}
          position={v}
          selected={selectedVertex === i}
          onMove={(idx, pos) => {
            const next = [...vertices];
            next[idx] = pos;
            onVerticesChange(next);
          }}
          onSelect={onSelectVertex}
        />
      ))}
    </>
  );
}
