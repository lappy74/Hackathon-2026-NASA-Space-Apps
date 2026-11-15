
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
  radiusMiles: number;
  address?: string;
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
  const radiusCircleRef = useRef<L.Circle | null>(null);
 
  const currentValueRef = useRef(value);
  const onSelectRef = useRef(onSelect);
  const initialValueRef = useRef(value);
  const reverseRequestRef = useRef(0);

  // City search states
  const [city, setCity] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  // Keep callback updated
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    currentValueRef.current = value;
  }, [value]);

  async function findNearestAddress(location: FarmLocation) {
    const requestId = ++reverseRequestRef.current;
    const params = new URLSearchParams({
      lat: String(location.latitude),
      lon: String(location.longitude),
      format: "jsonv2",
      zoom: "18",
      addressdetails: "1",
    });

    try {
      const response = await fetch(
        "https://nominatim.openstreetmap.org/reverse?" + params.toString(),
        { headers: { "Accept-Language": "en" } }
      );

      if (!response.ok) return;

      const result = await response.json() as { display_name?: string };
      if (
        requestId === reverseRequestRef.current &&
        result.display_name
      ) {
        onSelectRef.current({ ...location, address: result.display_name });
      }
    } catch {
      // Keep the selected coordinates if reverse geocoding is unavailable.
    }
  }

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
      const selectedLocation: FarmLocation = {
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
        radiusMiles: currentValueRef.current?.radiusMiles ?? 1,
      };

      onSelectRef.current(selectedLocation);
      void findNearestAddress(selectedLocation);
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

  // Remove marker and circle if no location
  if (!value) {
    markerRef.current?.remove();
    markerRef.current = null;

    radiusCircleRef.current?.remove();
    radiusCircleRef.current = null;

    return;
  }

  const point = L.latLng(
    value.latitude,
    value.longitude
  );

  // Create or move center marker
  if (markerRef.current) {
    markerRef.current.setLatLng(point);
  } else {
    markerRef.current = L.circleMarker(point, {
      radius: 9,
      color: "#155c32",
      fillColor: "#22c55e",
      fillOpacity: 1,
      weight: 3,
      interactive: false
    }).addTo(map);
  }

  // Leaflet uses meters for geographic circles
  const radiusMeters = value.radiusMiles * 1609.344;

  if (value.radiusMiles === 0) {
    // Zero miles means center point only
    radiusCircleRef.current?.remove();
    radiusCircleRef.current = null;

  } else if (radiusCircleRef.current) {
    // Update existing circle
    radiusCircleRef.current.setLatLng(point);
    radiusCircleRef.current.setRadius(radiusMeters);

  } else {
    // Create circle
    radiusCircleRef.current = L.circle(point, {
      radius: radiusMeters,
      color: "#155c32",
      fillColor: "#22c55e",
      fillOpacity: 0.15,
      weight: 2,
      interactive: false
    }).addTo(map);
  }

  // Keep center marker visible
  markerRef.current?.bringToFront();

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

	{/* FARM RADIUS CONTROL */}
	{value && (
  	<div style={{ padding: "12px" }}>

   	 <label htmlFor="farm-radius">
      	Coverage radius:
      	<strong> {value.radiusMiles.toFixed(1)} miles</strong>
	    </label>

	    <input
     	 id="farm-radius"
      	type="range"
      	min="0"
      	max="10"
      	step="0.1"
      	value={value.radiusMiles}
      	onChange={(event) => {
        	onSelect({
          	...value,
          	radiusMiles: Number(event.target.value),
        	});
      	}}
      	style={{
        	width: "100%",
        	accentColor: "#155c32",
        	marginTop: "12px"
      	}}
    />

    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: "12px",
        color: "#666"
      }}
    >
      <span>0 miles</span>
      <span>10 miles maximum</span>
    </div>

  </div>
)}


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

