-- Zones drawn on Leaflet world copies can be stored with lng > 180 (e.g. NYC at ~286).
-- Normalize to WGS84 so PostGIS queries and map pins share the same meridian.

UPDATE zones
SET geom = ST_SetSRID(ST_translate(geom::geometry, -360.0, 0.0), 4326)::geometry(Polygon, 4326)
WHERE ST_XMin(geom) > 180;

UPDATE zones
SET geom = ST_SetSRID(ST_translate(geom::geometry, 360.0, 0.0), 4326)::geometry(Polygon, 4326)
WHERE ST_XMax(geom) < -180;
