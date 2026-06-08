import L from 'leaflet';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { Link, Navigate } from 'react-router-dom';

import 'leaflet/dist/leaflet.css';

import { opsDelete, opsGet, opsPost, type OpsZone } from '../ops/opsApi';
import { clearOpsSession, getOpsUser, opsCanManageZones } from '../ops/opsAuth';

L.Icon.Default.mergeOptions({ iconRetinaUrl: iconRetina, iconUrl, shadowUrl: iconShadow });

const DEFAULT_CENTER: [number, number] = [23.5, 121.0];

type LatLng = { lat: number; lng: number };

function verticesToPolygon(vertices: LatLng[]): GeoJSON.Polygon | null {
  if (vertices.length < 3) return null;
  const ring = vertices.map((v) => [v.lng, v.lat] as [number, number]);
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

function polygonAreaKm2(vertices: LatLng[]): number | null {
  const poly = verticesToPolygon(vertices);
  if (!poly) return null;
  const ring = poly.coordinates[0];
  const lat0 = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  let areaM2 = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const ax = x1 * mPerDegLng;
    const ay = y1 * mPerDegLat;
    const bx = x2 * mPerDegLng;
    const by = y2 * mPerDegLat;
    areaM2 += ax * by - bx * ay;
  }
  return Math.abs(areaM2 / 2) / 1_000_000;
}

function PolygonDrawHandler({
  active,
  onAddVertex,
}: {
  active: boolean;
  onAddVertex: (v: LatLng) => void;
}) {
  useMapEvents({
    click(e) {
      if (!active) return;
      onAddVertex({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function FitZonesBounds({ zones }: { zones: OpsZone[] }) {
  const map = useMap();
  useEffect(() => {
    if (zones.length === 0) return;
    const bounds = L.latLngBounds([]);
    zones.forEach((z) => {
      z.geom.coordinates[0].forEach(([lng, lat]) => bounds.extend([lat, lng]));
    });
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
    }
  }, [map, zones]);
  return null;
}

export function OpsZones() {
  const user = getOpsUser();
  const [zones, setZones] = useState<OpsZone[]>([]);
  const [name, setName] = useState('');
  const [vertices, setVertices] = useState<LatLng[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [closed, setClosed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canManage = user ? opsCanManageZones(user.role) : false;

  const load = useCallback(() => {
    opsGet<{ items: OpsZone[] }>('/v1/ops/zones')
      .then((d) => {
        setZones(d.items);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const draftPolygon = useMemo(() => verticesToPolygon(vertices), [vertices]);
  const draftAreaKm2 = useMemo(() => polygonAreaKm2(vertices), [vertices]);
  const leafletPositions = useMemo(
    () => vertices.map((v) => [v.lat, v.lng] as [number, number]),
    [vertices],
  );

  const resetDraft = () => {
    setVertices([]);
    setDrawing(false);
    setClosed(false);
  };

  const startDrawing = () => {
    resetDraft();
    setDrawing(true);
    setErr(null);
  };

  const finishDrawing = () => {
    if (vertices.length < 3) {
      setErr('至少需要 3 個頂點才能完成多邊形');
      return;
    }
    setClosed(true);
    setDrawing(false);
    setErr(null);
  };

  const undoVertex = () => {
    setVertices((prev) => prev.slice(0, -1));
    setClosed(false);
  };

  const addVertex = (v: LatLng) => {
    setVertices((prev) => [...prev, v]);
    setClosed(false);
  };

  if (!user) {
    return <Navigate to="/ops/login" replace />;
  }

  const createZone = async () => {
    if (!name.trim()) {
      setErr('請輸入分區名稱');
      return;
    }
    if (!draftPolygon || !closed) {
      setErr('請先在地圖上畫完多邊形並按「完成多邊形」');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await opsPost('/v1/ops/zones', {
        name: name.trim(),
        geom: draftPolygon,
      });
      setName('');
      resetDraft();
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeZone = async (id: string) => {
    if (!window.confirm('刪除此分區？')) return;
    setBusy(true);
    try {
      await opsDelete(`/v1/ops/zones/${id}`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    clearOpsSession();
    window.location.href = '/ops/login';
  };

  return (
    <section className="card">
      <h1>營運分區</h1>
      <p>
        <Link to="/dashboard">儀表板</Link> · {user.email} ({user.role})
        {' · '}
        <button type="button" onClick={logout}>
          登出
        </button>
      </p>
      {err && <p className="error">{err}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 2fr', gap: 16 }}>
        <div>
          <h2>分區列表 ({zones.length})</h2>
          {zones.length === 0 && <p className="muted">尚無分區</p>}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {zones.map((z) => (
              <li key={z.id} style={{ marginBottom: 8, borderBottom: '1px solid #ddd', paddingBottom: 8 }}>
                <strong>{z.name}</strong>
                <br />
                <span className="muted" style={{ fontSize: 12 }}>
                  {z.id.slice(0, 8)}…
                </span>
                {canManage && (
                  <>
                    {' '}
                    <button type="button" onClick={() => removeZone(z.id)} disabled={busy}>
                      刪除
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          {canManage && (
            <div style={{ marginTop: 16 }}>
              <h3>畫多邊形分區</h3>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                在地圖上依序點擊頂點，不限大小；至少 3 點後按「完成多邊形」再建立。
              </p>
              <label className="field">
                <span>名稱</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：北區、全縣西半" />
              </label>
              <p className="muted" style={{ fontSize: 13 }}>
                頂點：{vertices.length}
                {draftAreaKm2 != null && closed && (
                  <>
                    {' '}
                    · 約 {draftAreaKm2 < 1 ? `${(draftAreaKm2 * 100).toFixed(0)} ha` : `${draftAreaKm2.toFixed(1)} km²`}
                  </>
                )}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {!drawing && !closed && (
                  <button type="button" onClick={startDrawing} disabled={busy}>
                    開始畫區
                  </button>
                )}
                {drawing && (
                  <>
                    <button type="button" onClick={finishDrawing} disabled={vertices.length < 3}>
                      完成多邊形
                    </button>
                    <button type="button" onClick={undoVertex} disabled={vertices.length === 0}>
                      復原上一步
                    </button>
                    <button type="button" onClick={resetDraft}>
                      取消
                    </button>
                  </>
                )}
                {closed && (
                  <>
                    <button type="button" onClick={createZone} disabled={busy}>
                      建立分區
                    </button>
                    <button type="button" onClick={startDrawing} disabled={busy}>
                      重畫
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            height: 'min(70vh, 640px)',
            minHeight: 480,
            border: '1px solid #ccc',
            borderRadius: 8,
            overflow: 'hidden',
            cursor: drawing ? 'crosshair' : undefined,
          }}
        >
          <MapContainer center={DEFAULT_CENTER} zoom={8} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <FitZonesBounds zones={zones} />
            {canManage && <PolygonDrawHandler active={drawing} onAddVertex={addVertex} />}
            {zones.map((z) => {
              const feature: GeoJSON.Feature<GeoJSON.Polygon> = {
                type: 'Feature',
                properties: { name: z.name },
                geometry: z.geom,
              };
              return (
                <GeoJSON
                  key={z.id}
                  data={feature}
                  style={{ color: '#c62828', weight: 2, fillOpacity: 0.12 }}
                />
              );
            })}
            {vertices.length >= 2 && !closed && (
              <Polyline positions={leafletPositions} pathOptions={{ color: '#1565c0', weight: 2, dashArray: '6 4' }} />
            )}
            {closed && draftPolygon && (
              <Polygon
                positions={leafletPositions}
                pathOptions={{ color: '#1565c0', weight: 2, fillOpacity: 0.15 }}
              />
            )}
            {vertices.map((v, i) => (
              <CircleMarker
                key={`${v.lat}-${v.lng}-${i}`}
                center={[v.lat, v.lng]}
                radius={5}
                pathOptions={{ color: '#1565c0', fillColor: '#fff', fillOpacity: 1, weight: 2 }}
              />
            ))}
          </MapContainer>
        </div>
      </div>
    </section>
  );
}
