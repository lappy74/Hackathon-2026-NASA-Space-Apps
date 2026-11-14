
import { useEffect, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";

export type FarmLocation = {
  latitude: number;
  longitude: number;
};

type FarmMapProps = {
  value: FarmLocation | null;
  onSelect: (location: FarmLocation) => void;
};

export default function FarmMap({
  value,
  onSelect,
}: FarmMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const onSelectRef = useRef(onSelect);
  const initialValueRef = useRef(value);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current) return;

    const initial = initialValueRef.current;

    const map = L.map(containerRef.current).setView(
      initial
        ? [initial.latitude, initial.longitude]
        : [38.44, -122.71],
      12
    );

    mapRef.current = map;

    L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }
    ).addTo(map);

    map.on("click", (event: L.LeafletMouseEvent) => {
      onSelectRef.current({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;

    if (!map) return;

    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const point = L.latLng(value.latitude, value.longitude);

    if (markerRef.current) {
      markerRef.current.setLatLng(point);
    } else {
      markerRef.current = L.circleMarker(point, {
        radius: 9,
        color: "#155c32",
        fillColor: "#22c55e",
        fillOpacity: 1,
        weight: 3,
      }).addTo(map);
    }
  }, [value]);

  return (
    <div>
      <div ref={containerRef} className="farm-map" />

      <div style={{ padding: "12px" }}>
        {value ? (
          <p>
            Selected location: {value.latitude.toFixed(6)},
            {" "}
            {value.longitude.toFixed(6)}
          </p>
        ) : (
          <p>Click the map to select your farmland.</p>
        )}
      </div>
    </div>
  );
}

