
import {
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";

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
  onSelect
}: FarmMapProps) {

  // Map references
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const onSelectRef = useRef(onSelect);
  const initialValueRef = useRef(value);

  // City search states
  const [city, setCity] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  // Keep callback updated
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // INITIALIZE OPENSTREETMAP
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

    // Farmer selects a field
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


  // UPDATE SELECTED FIELD MARKER
  useEffect(() => {
    const map = mapRef.current;

    if (!map) return;

    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const point = L.latLng(
      value.latitude,
      value.longitude
    );

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

  // SEARCH FOR CITY USING NOMINATIM
  async function searchCity(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!city.trim() || searching) return;

    setSearching(true);
    setSearchError("");

    try {
      const params = new URLSearchParams({
        q: city.trim(),
        format: "jsonv2",
        limit: "1",
      });

      const response = await fetch(
        "https://nominatim.openstreetmap.org/search?" +
          params.toString()
      );

      if (!response.ok) {
        throw new Error("Search request failed");
      }

      const results = await response.json();

      if (results.length === 0) {
        setSearchError("City not found. Try adding the state or country.");
        return;
      }

      const latitude = Number(results[0].lat);
      const longitude = Number(results[0].lon);

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        throw new Error("Invalid coordinates returned");
      }

      // Move the map to the searched city
      mapRef.current?.flyTo(
        [latitude, longitude],
        12
      );

      console.log("City found:", latitude, longitude);

    } catch (error) {
      console.error(error);
      setSearchError("Unable to search. Try again later.");
    } finally {
      setSearching(false);
    }
  }

  // DISPLAY MAP AND SEARCH BAR
  return (
    <div>

      {/* CITY SEARCH BAR */}
      <form
        onSubmit={searchCity}
        style={{
          display: "flex",
          gap: "8px",
          padding: "12px"
        }}
      >
        <input
          type="text"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          placeholder="Search city or location..."
          aria-label="Search for a location"
          style={{
  		flex: 1,
  		minWidth: 0,
  		padding: "10px",
  		borderRadius: "8px",
  		border: "1px solid #ccc",
  		backgroundColor: "#ffffff",
  		color: "#222222",
  		WebkitTextFillColor: "#222222",
  		fontSize: "14px"
		}}
        />

        <button
          type="submit"
          disabled={searching}
          style={{
            padding: "10px 18px",
            borderRadius: "8px",
            background: "#155c32",
            color: "white",
            border: "none",
            cursor: "pointer"
          }}
        >
          {searching ? "Searching..." : "Search"}
        </button>
      </form>

      {/* SEARCH ERROR */}
      {searchError && (
        <p role="alert" style={{ padding: "0 12px" }}>
          {searchError}
        </p>
      )}

      {/* INTERACTIVE MAP */}
      <div
        ref={containerRef}
        className="farm-map"
      />

      {/* SELECTED COORDINATES */}
      <div style={{ padding: "12px" }}>
        {value ? (
          <p>
            Selected farm:
            {" "}
            {value.latitude.toFixed(6)},
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

