import L from 'leaflet';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GeoJSON, MapContainer, Rectangle, TileLayer, useMapEvents } from 'react-leaflet';
import { Link, Navigate } from 'react-router-dom';

import 'leaflet/dist/leaflet.css';

import { bboxForBox, DEFAULT_BOX_SIDE_KM } from '../offline/tileMath';
import { opsDelete, opsGet, opsPost, type OpsZone } from '../ops/opsApi';
import { clearOpsSession, getOpsUser, opsCanManageZones } from '../ops/opsAuth';

L.Icon.Default.mergeOptions({ iconRetinaUrl: iconRetina, iconUrl, shadowUrl: iconShadow });

const DEFAULT_CENTER = { lat: 23.5, lng: 121.0 };

function bboxToPolygon(bbox: { south: number; west: number; north: number; east: number }): GeoJSON.Polygon {
  const { south, west, north, east } = bbox;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

function CenterTracker({ onCenter }: { onCenter: (c: { lat: number; lng: number }) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      onCenter({ lat: c.lat, lng: c.lng });
    },
  });
  useEffect(() => {
    const c = map.getCenter();
    onCenter({ lat: c.lat, lng: c.lng });
  }, [map, onCenter]);
  return null;
}

export function OpsZones() {
  const user = getOpsUser();
  const [zones, setZones] = useState<OpsZone[]>([]);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [name, setName] = useState('');
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

  const previewBbox = useMemo(() => bboxForBox(center, DEFAULT_BOX_SIDE_KM), [center]);
  const previewGeom = useMemo(() => bboxToPolygon(previewBbox), [previewBbox]);

  const onCenter = useCallback((c: { lat: number; lng: number }) => setCenter(c), []);

  if (!user) {
    return <Navigate to="/ops/login" replace />;
  }

  const createZone = async () => {
    if (!name.trim()) {
      setErr('請輸入分區名稱');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await opsPost('/v1/ops/zones', {
        name: name.trim(),
        geom: previewGeom,
      });
      setName('');
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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 2fr', gap: 16 }}>
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
              <h3>以地圖中心建立 {DEFAULT_BOX_SIDE_KM}×{DEFAULT_BOX_SIDE_KM} km</h3>
              <label className="field">
                <span>名稱</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：北區 A" />
              </label>
              <p className="muted" style={{ fontSize: 13 }}>
                中心：{center.lat.toFixed(5)}, {center.lng.toFixed(5)}
              </p>
              <button type="button" onClick={createZone} disabled={busy}>
                建立分區
              </button>
            </div>
          )}
        </div>

        <div style={{ height: 480, border: '1px solid #ccc', borderRadius: 8, overflow: 'hidden' }}>
          <MapContainer center={[center.lat, center.lng]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <CenterTracker onCenter={onCenter} />
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
            {canManage && (
              <Rectangle
                bounds={[
                  [previewBbox.south, previewBbox.west],
                  [previewBbox.north, previewBbox.east],
                ]}
                pathOptions={{ color: '#1565c0', weight: 2, dashArray: '6 4', fillOpacity: 0.08 }}
              />
            )}
          </MapContainer>
        </div>
      </div>
    </section>
  );
}
