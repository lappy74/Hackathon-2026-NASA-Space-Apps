
import { useEffect, useState } from "react";
import type { FarmLocation } from "./FarmMap";

type Period = "daily" | "weekly" | "monthly" | "yearly";

type WeatherDay = {
  date: string;
  temp_avg: number;
  rain: number;
  humidity: number;
  daily_gdd: number;
  cumulative_gdd: number;
};

type WeatherResponse = {
  selected_point: {
    latitude: number;
    longitude: number;
  };
  summary_metrics: {
    total_gdd: number;
  };
  daily: WeatherDay[];
};

// Format a local date as YYYY-MM-DD.
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Find the start of a period using its final date.
function periodStart(endDate: string, length: number): string {
  const date = new Date(`${endDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - length + 1);
  return date.toISOString().slice(0, 10);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) /
    values.length;
}

export default function FieldDataPanel({
  location,
}: {
  location: FarmLocation;
}) {
  const [period, setPeriod] = useState<Period>("daily");

  const [weather, setWeather] =
    useState<WeatherResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setWeather(null);
    setError("");

    // Request enough historical data for all three modes.
    // End yesterday; NASA may not yet have the latest days.
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 400);

    const params = new URLSearchParams({
      lat: String(location.latitude),
      lon: String(location.longitude),
      start: formatDate(startDate),
      end: formatDate(endDate),
    });

    // Uses the working Vite -> FastAPI proxy.
    fetch(`/api/weather?${params}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `NASA POWER API error: ${response.status}`
          );
        }
        return response.json() as Promise<WeatherResponse>;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setWeather(result);
        }
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [location.latitude, location.longitude]);

  // Choose how many calendar days to summarize.
  const periodLength =
    period === "daily" ? 1 :
    period === "weekly" ? 7 : 30;
    period === "monthly" ? 30 : 365;

  const days = weather?.daily ?? [];
  const latest = days.length > 0 ? days[days.length - 1] : null;

  const firstDate = latest
    ? periodStart(latest.date, periodLength)
    : null;

  // Use only observations within the chosen period.
  const selectedDays = firstDate
    ? days.filter((day) =>
        day.date >= firstDate && day.date <= latest!.date
      )
    : [];

  // Averages for temperature/humidity.
  const averageTemperature = average(
    selectedDays.map((day) => day.temp_avg)
  );

  const averageHumidity = average(
    selectedDays.map((day) => day.humidity)
  );

  // Totals for rainfall/GDD.
  const totalRainfall = selectedDays.reduce(
    (total, day) => total + day.rain,
    0
  );

  const totalGDD = selectedDays.reduce(
    (total, day) => total + day.daily_gdd,
    0
  );

  // Label for how long the data is
  const periodLabel =
    period === "daily" ? "Latest available day" :
    period === "weekly" ? "Last 7 days" :
    period === "monthly" ? "Last 30 days" :
   "Last 365 days";


  const buttonStyle = (selected: boolean) => ({
    padding: "10px 16px",
    borderRadius: "8px",
    border: "1px solid #456078",
    backgroundColor: selected ? "#155c32" : "#16324c",
    color: "#ffffff",
    WebkitTextFillColor: "#ffffff",
    cursor: "pointer",
    fontWeight: selected ? 700 : 400,
  } as const);

  return (
    <div
      style={{
        padding: "16px",
        color: "#f1f5f9",
      }}
    >
      <h3>NASA POWER Field Data</h3>

      <p>
        Latitude: {location.latitude.toFixed(5)}
        {" | "}
        Longitude: {location.longitude.toFixed(5)}
      </p>

      <p>
        Selected radius: {location.radiusMiles.toFixed(1)} miles
      </p>

      {/* TIME PERIOD SELECTOR */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          marginTop: "16px",
          marginBottom: "16px",
        }}
      >
        {(["daily", "weekly", "monthly", "yearly"] as Period[]).map(
          (option) => (
            <button
              key={option}
              type="button"
              aria-pressed={period === option}
              onClick={() => setPeriod(option)}
              style={buttonStyle(period === option)}
            >
              {option.charAt(0).toUpperCase() +
                option.slice(1)}
            </button>
          )
        )}
      </div>

      {loading && <p>Loading NASA data...</p>}

      {error && (
        <p role="alert" style={{ color: "#ff8585" }}>
          {error}
        </p>
      )}

      {weather && latest && (
        <div>
          <h4>{periodLabel}</h4>

          <p>
            Period: {firstDate} to {latest.date}
          </p>

          <p>
            Available daily observations:{" "}
            {selectedDays.length} / {periodLength}
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "12px",
              marginTop: "16px",
            }}
          >
            <div>
              <strong>Average Temperature</strong>
              <p>{averageTemperature.toFixed(1)} °C</p>
            </div>

            <div>
              <strong>Average Humidity</strong>
              <p>{averageHumidity.toFixed(1)}%</p>
            </div>

            <div>
              <strong>Total Rainfall</strong>
              <p>{totalRainfall.toFixed(1)} mm</p>
            </div>

            <div>
              <strong>Growing Degree Days</strong>
              <p>{totalGDD.toFixed(1)} °C-days</p>
            </div>
          </div>

          <p
            style={{
              marginTop: "16px",
              fontSize: "12px",
              color: "#cbd5e1",
            }}
          >
            NASA POWER historical meteorological data.
            Latest available observation: {latest.date}.
            Not a live temperature reading.
          </p>
        </div>
      )}

      {weather && !latest && (
        <p>No observations available for this period.</p>
      )}
    </div>
  );
}


