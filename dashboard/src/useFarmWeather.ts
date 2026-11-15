
import { useEffect, useState } from "react";
import type { FarmLocation } from "./FarmMap";
import { apiUrl } from "./api";

export type WeatherDay = {
  date: string;
  temp_avg: number;
  rain: number;
  humidity: number;
  daily_gdd: number;
  cumulative_gdd: number;
};

type WeatherResponse = {
  daily: WeatherDay[];
};

export function useFarmWeather(
  location: FarmLocation | null,
  baseTemp: number
) {
  const [days, setDays] = useState<WeatherDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!location) {
      setDays([]);
      setError("");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    setLoading(true);
    setDays([]);
    setError("");

    // Request through today. NASA POWER may lag by a few days; unavailable
    // rows are marked -999 by the API and removed by APIcall.py, leaving the
    // latest completed observation available from NASA.
    const end = new Date();

    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 400);

    const params = new URLSearchParams({
      lat: String(location.latitude),
      lon: String(location.longitude),
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      base_temp: String(baseTemp),
    });

    fetch(apiUrl(`/api/weather?${params}`), {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Weather API error: ${response.status}`);
        }
        return response.json() as Promise<WeatherResponse>;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setDays(result.daily);
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
  }, [location?.latitude, location?.longitude, baseTemp]);

  return { days, loading, error };
}

export function summarizeWeather(
  days: WeatherDay[],
  periodDays: number
) {
  if (days.length === 0) return null;

  const latest = days[days.length - 1];

  const endTime = Date.parse(`${latest.date}T00:00:00Z`);
  const startTime = endTime - (periodDays - 1) * 86400000;
  const startDate = new Date(startTime).toISOString().slice(0, 10);

  const selected = days.filter(
    (day) => day.date >= startDate && day.date <= latest.date
  );

  if (selected.length === 0) return null;

  const sum = (values: number[]) =>
    values.reduce((total, value) => total + value, 0);

  return {
    temperature:
      sum(selected.map((day) => day.temp_avg)) / selected.length,

    humidity:
      sum(selected.map((day) => day.humidity)) / selected.length,

    rainfall: sum(selected.map((day) => day.rain)),

    gdd: sum(selected.map((day) => day.daily_gdd)),

    latestDate: latest.date,
    observationCount: selected.length,
  };
}
