import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

import type { MapMarker } from './ContributorMap';
import {
  aggregateMarkersForDisplay,
  pinFillColor,
  type DisplayMapMarker,
} from '../../utils/mapMarkers';

type Labels = {
  damageLabel: (level: string) => string;
  mineLabel: string;
  reportCount: (count: number) => string;
  viewDetails: string;
  siteRepaired: string;
  siteDemolished: string;
};

type Props = {
  markers: MapMarker[];
  showOthers: boolean;
  mapMode: 'all' | 'mine' | 'new';
  labels: Labels;
  onViewDetails: (m: MapMarker) => void;
};

type TaggedCircleMarker = L.CircleMarker & { _bihId?: string; _bihPopupSig?: string };

function popupSignature(m: DisplayMapMarker): string {
  return [
    m.id,
    m.thumb_url ?? '',
    m.displayDamageLevel,
    m.pinDisplay,
    m.reportCount,
    m.captured_at_client,
    m.is_mine,
  ].join('|');
}

function popupHtml(m: DisplayMapMarker, labels: Labels): string {
  const statusLine =
    m.pinDisplay === 'repaired'
      ? labels.siteRepaired
      : m.pinDisplay === 'demolished'
        ? labels.siteDemolished
        : labels.damageLabel(m.displayDamageLevel);
  const thumb = m.thumb_url
    ? `<img src="${m.thumb_url}" alt="" style="max-width:120px;border-radius:6px;display:block" onerror="this.onerror=null;this.style.display='none';" />`
    : '';
  const count =
    m.reportCount > 1
      ? `<p style="margin:0.25rem 0 0;font-size:0.78rem;color:#64748b">${labels.reportCount(m.reportCount)}</p>`
      : '';
  const mine = m.is_mine ? ` · ${labels.mineLabel}` : '';
  const time = new Date(m.captured_at_client).toLocaleString();
  return `<div class="marker-popup">${thumb}<p style="margin:0.35rem 0 0"><strong>${statusLine}</strong>${mine}</p><time style="font-size:0.78rem;color:#64748b">${time}</time>${count}<p style="margin:0.5rem 0 0"><button type="button" class="primary small marker-popup-btn" data-report-id="${m.id}">${labels.viewDetails}</button></p></div>`;
}

function bindMarkerPopup(
  layer: TaggedCircleMarker,
  m: DisplayMapMarker,
  map: L.Map,
  labels: Labels,
  onViewDetails: (m: MapMarker) => void,
) {
  const sig = popupSignature(m);
  if (layer._bihPopupSig === sig) return;
  layer._bihPopupSig = sig;
  const popup = L.popup({ maxWidth: 280 }).setContent(popupHtml(m, labels));
  layer.bindPopup(popup);
  layer.off('popupopen');
  layer.on('popupopen', () => {
    const el = document.querySelector(
      `.marker-popup-btn[data-report-id="${m.id}"]`,
    ) as HTMLButtonElement | null;
    if (!el) return;
    el.onclick = () => {
      map.closePopup();
      onViewDetails(m);
    };
  });
}

export function ClusteredReportMarkers({
  markers,
  showOthers,
  mapMode,
  labels,
  onViewDetails,
}: Props) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);
  const onViewRef = useRef(onViewDetails);
  const labelsRef = useRef(labels);
  const popupOpenRef = useRef(false);
  onViewRef.current = onViewDetails;
  labelsRef.current = labels;

  useEffect(() => {
    const display = aggregateMarkersForDisplay(markers).filter(
      (m) => showOthers || m.is_mine,
    );

    if (!groupRef.current) {
      groupRef.current = (L as typeof L & { markerClusterGroup: (o?: object) => L.MarkerClusterGroup }).markerClusterGroup({
        maxClusterRadius: 56,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        disableClusteringAtZoom: 17,
      });
      map.addLayer(groupRef.current);

      groupRef.current.on('clusterclick', (e) => {
        const layer = e.layer as L.MarkerCluster;
        if (map.getZoom() >= 17) return;
        map.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: 17 });
      });
    }

    const group = groupRef.current;
    if (popupOpenRef.current) return;
    const showActions = mapMode === 'all' || mapMode === 'mine';
    const existingById = new Map<string, TaggedCircleMarker>();
    group.eachLayer((layer) => {
      const tagged = layer as TaggedCircleMarker;
      if (tagged._bihId) existingById.set(tagged._bihId, tagged);
    });

    const nextIds = new Set<string>();
    for (const m of display) {
      nextIds.add(m.id);
      const [lng, lat] = m.geom.coordinates;
      const color = pinFillColor(m);
      const existing = existingById.get(m.id);
      if (existing) {
        const prev = existing.getLatLng();
        if (Math.abs(prev.lat - lat) > 1e-7 || Math.abs(prev.lng - lng) > 1e-7) {
          existing.setLatLng([lat, lng]);
        }
        const radius = m.is_mine ? 11 : 9;
        const opts = existing.options;
        if (
          opts.radius !== radius ||
          opts.fillColor !== color ||
          opts.fillOpacity !== 0.95
        ) {
          existing.setStyle({
            radius,
            color: '#fff',
            weight: 2,
            fillColor: color,
            fillOpacity: 0.95,
          });
        }
        if (showActions) {
          bindMarkerPopup(existing, m, map, labelsRef.current, onViewRef.current);
        } else {
          existing.unbindPopup();
        }
        continue;
      }

      const layer = L.circleMarker([lat, lng], {
        radius: m.is_mine ? 11 : 9,
        color: '#fff',
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95,
      }) as TaggedCircleMarker;
      layer._bihId = m.id;

      if (showActions) {
        bindMarkerPopup(layer, m, map, labelsRef.current, onViewRef.current);
      }

      group.addLayer(layer);
    }

    for (const [id, layer] of existingById) {
      if (!nextIds.has(id)) group.removeLayer(layer);
    }
  }, [markers, showOthers, mapMode, map]);

  useEffect(() => {
    const onOpen = () => {
      popupOpenRef.current = true;
    };
    const onClose = () => {
      popupOpenRef.current = false;
    };
    map.on('popupopen', onOpen);
    map.on('popupclose', onClose);
    return () => {
      map.off('popupopen', onOpen);
      map.off('popupclose', onClose);
    };
  }, [map]);

  useEffect(() => {
    return () => {
      if (groupRef.current) {
        map.removeLayer(groupRef.current);
        groupRef.current = null;
      }
    };
  }, [map]);

  return null;
}
