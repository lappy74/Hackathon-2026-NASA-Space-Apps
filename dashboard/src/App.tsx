import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import type { CSSProperties } from "react";
import { supabase } from "./lib/supabase";
import FarmMap, { type FarmLocation } from "./FarmMap";
import LoRaDashboard from "./LoRaDashboard";
import FieldDataPanel, {
  PeriodSelector,
  type Period,
} from "./FieldDataPanel";
import {
  useFarmWeather,
  summarizeWeather,
} from "./useFarmWeather";

type Range = "Today" | "1 month" | "6 months";

type Metric = {
  title: string;
  value: string;
  unit: string;
  change: string;
  color: string;
  softColor: string;
  icon: "temperature" | "rainfall" | "gdd" | "humidity" | "soil" | "health";
  data: Record<Range, number[]>;
  chartValues?: number[];
  chartLabels?: string[];
};

const metrics: Metric[] = [
  {
    title: "Temperature",
    value: "24.8",
    unit: "°C",
    change: "+1.2° from yesterday",
    color: "#d1a326",
    softColor: "#fbf3dc",
    icon: "temperature",
    data: {
      Today: [19, 20, 21, 24, 27, 29, 28, 26, 25, 24],
      "1 month": [21, 23, 20, 24, 26, 23, 27, 25, 28, 24, 25, 26],
      "6 months": [16, 18, 21, 24, 28, 30, 29, 27, 25, 23, 21, 20],
    },
  },
  {
    title: "Rainfall",
    value: "12.4",
    unit: "mm",
    change: "3 rain events this month",
    color: "#d1a326",
    softColor: "#fbf3dc",
    icon: "rainfall",
    data: {
      Today: [0, 0, 1, 1, 6, 12, 9, 3, 1, 0],
      "1 month": [2, 8, 3, 12, 4, 1, 9, 5, 14, 6, 2, 7],
      "6 months": [48, 62, 35, 81, 55, 42, 69, 33, 76, 51, 44, 58],
    },
  },
  {
    title: "Growing degree days",
    value: "842",
    unit: "GDD",
    change: "68% of season target",
    color: "#d1a326",
    softColor: "#faf1d9",
    icon: "gdd",
    data: {
      Today: [4, 9, 15, 23, 31, 41, 50, 59, 67, 76],
      "1 month": [80, 130, 190, 255, 320, 405, 488, 570, 665, 745, 790, 842],
      "6 months": [30, 92, 175, 285, 410, 538, 650, 742, 795, 821, 836, 842],
    },
  },
  {
    title: "Humidity",
    value: "67",
    unit: "%",
    change: "Within optimal range",
    color: "#d1a326",
    softColor: "#fbf3dc",
    icon: "humidity",
    data: {
      Today: [78, 76, 71, 65, 59, 55, 58, 64, 67, 69],
      "1 month": [71, 65, 73, 62, 69, 75, 68, 64, 72, 66, 70, 67],
      "6 months": [76, 72, 68, 61, 58, 55, 60, 64, 69, 73, 70, 67],
    },
  },
];

const soilWaterMetrics: Metric[] = [
  {
    title: "Soil moisture",
    value: "56",
    unit: "%",
    change: "Within ideal range",
    color: "#d1a326",
    softColor: "#fbf3dc",
    icon: "soil",
    data: {
      Today: [54, 56, 57, 56, 55, 54, 53, 55, 56, 56],
      "1 month": [62, 59, 57, 52, 49, 56, 61, 59, 54, 50, 53, 56],
      "6 months": [48, 53, 61, 65, 58, 51, 47, 55, 63, 60, 57, 56],
    },
  },
  { ...metrics[3], title: "Humidity" },
  {
    title: "Soil health",
    value: "82",
    unit: "/100",
    change: "Healthy biological activity",
    color: "#d1a326",
    softColor: "#faf1d9",
    icon: "health",
    data: {
      Today: [76, 78, 79, 80, 81, 80, 82, 82, 83, 82],
      "1 month": [72, 75, 74, 77, 79, 78, 80, 81, 82, 81, 83, 82],
      "6 months": [61, 64, 67, 69, 72, 70, 74, 77, 79, 80, 81, 82],
    },
  },
];

const ranges: Range[] = ["Today", "1 month", "6 months"];

function Icon({ type }: { type: Metric["icon"] }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (type === "temperature") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M14 14.76V5a4 4 0 0 0-8 0v9.76a6 6 0 1 0 8 0Z" />
        <path d="M10 9v8" />
      </svg>
    );
  }
  if (type === "rainfall") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M7 16.5H5.5a4.5 4.5 0 0 1-.5-8.97A7 7 0 0 1 18.3 9.5h.2a3.5 3.5 0 1 1 0 7H17" />
        <path d="m9 15-1 4M13 15l-1 4M17 15l-1 4" />
      </svg>
    );
  }
  if (type === "gdd") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M12 21V9" />
        <path d="M12 14c-4.5 0-7-2.5-7-6 4.5 0 7 2.5 7 6ZM12 10c0-4 2.5-6 7-6 0 4-2.5 6-7 6Z" />
      </svg>
    );
  }
  if (type === "soil") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
        <path d="M7 4v16M17 4v16" />
      </svg>
    );
  }
  if (type === "health") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M12 20S4 15.4 4 9.3A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8 2.3C20 15.4 12 20 12 20Z" />
        <path d="M8 12h2l1.2-2.5L13 15l1.4-3H16" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <path d="M12 2.8S5.5 10.1 5.5 15a6.5 6.5 0 0 0 13 0C18.5 10.1 12 2.8 12 2.8Z" />
      <path d="M9 16.5a3.2 3.2 0 0 0 3 1.8" />
    </svg>
  );
}

function LineChart({
  values,
  color,
  yLabel = "",
  xLabels = ["Start", "Latest"],
}: {
  values: number[];
  color: string;
  yLabel?: string;
  xLabels?: string[];
}) {
  const id = useId().replace(/:/g, "");
  const width = 480;
  const height = 144;
  const plotLeft = 42;
  const plotRight = 8;
  const plotTop = 10;
  const plotBottom = 32;
  const plotWidth = width - plotLeft - plotRight;
  const plotHeight = height - plotTop - plotBottom;
  if (values.length === 0) {
    return <div className="chart" aria-hidden="true" />;
  }
  const min = 0;
  const max = Math.max(...values, 0);
  const spread = max - min || 1;
  const points = values.map((value, index) => {
    const x = values.length === 1
      ? plotLeft + plotWidth / 2
      : plotLeft + (index / (values.length - 1)) * plotWidth;
    const y = plotTop + plotHeight - ((value - min) / spread) * plotHeight;
    return [x, y];
  });
  const line = points.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");
  const area = values.length > 1
    ? `${line} L ${plotLeft + plotWidth} ${plotTop + plotHeight} L ${plotLeft} ${plotTop + plotHeight} Z`
    : "";
  const yTicks = [0, 0.5, 1].map((position) => ({
    y: plotTop + plotHeight - position * plotHeight,
    value: min + position * spread,
  }));
  const xLabelCount = Math.min(4, xLabels.length);
  const xLabelIndexes = xLabelCount === 1
    ? [0]
    : Array.from({ length: xLabelCount }, (_, index) =>
        Math.round((index * (xLabels.length - 1)) / (xLabelCount - 1))
      );

  return (
    <div className="chart" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".24" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map(({ y, value }) => (
          <g key={y}>
            <line x1={plotLeft} y1={y} x2={plotLeft + plotWidth} y2={y} className="grid-line" />
            <text x={plotLeft - 6} y={y + 3} textAnchor="end" className="axis-label">
              {value.toFixed(1)}
            </text>
          </g>
        ))}
        <line x1={plotLeft} y1={plotTop} x2={plotLeft} y2={plotTop + plotHeight} className="axis-line" />
        <line x1={plotLeft} y1={plotTop + plotHeight} x2={plotLeft + plotWidth} y2={plotTop + plotHeight} className="axis-line" />
        {yLabel && (
          <text
            x="9"
            y={plotTop + plotHeight / 2}
            textAnchor="middle"
            className="axis-title"
            transform={`rotate(-90 9 ${plotTop + plotHeight / 2})`}
          >
            {yLabel}
          </text>
        )}
        {xLabelIndexes.map((labelIndex, index) => {
          const x = xLabels.length === 1
            ? plotLeft + plotWidth / 2
            : plotLeft + (labelIndex / (xLabels.length - 1)) * plotWidth;
          return (
            <text
              key={`${xLabels[labelIndex]}-${labelIndex}`}
              x={x}
              y={height - 8}
              textAnchor={index === 0 ? "start" : index === xLabelIndexes.length - 1 ? "end" : "middle"}
              className="axis-label"
            >
              {xLabels[labelIndex]}
            </text>
          );
        })}
        {area && <path d={area} fill={`url(#${id})`} />}
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
        {points.map(([x, y], index) => (
          <circle
            key={index}
            cx={x}
            cy={y}
            r={index === points.length - 1 ? 4.5 : 0}
            fill="#fff"
            stroke={color}
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}

function MetricCard({
  metric,
  period,
  baseTemp,
  onBaseTempChange,
}: {
  metric: Metric;
  period: Period;
  baseTemp?: string;
  onBaseTempChange?: (value: string) => void;
}) {
  const fallbackValues = metric.data.Today;
  const chartValues = metric.chartValues ?? (
    period === "daily"
      ? [fallbackValues[fallbackValues.length - 1]]
      : fallbackValues
  );

  return (
    <article className="metric-card">
      <div className="metric-top">
        <div className="metric-heading">
          <span
            className="metric-icon"
            style={{ color: metric.color, background: metric.softColor }}
          >
            <Icon type={metric.icon} />
          </span>
          <div>
            <p className="eyebrow">Field average</p>
            <h2>{metric.title}</h2>
          </div>
        </div>
      </div>
      <div className="metric-content">
        <div className="reading">
          <p>
            {metric.value}
            <span>{metric.unit}</span>
          </p>
          <small>{metric.change}</small>
        </div>
        <LineChart
          values={chartValues}
          color={metric.color}
          yLabel={metric.unit}
          xLabels={metric.chartLabels ?? ["Start", "Latest"]}
        />
      </div>
      {metric.icon === "gdd" && baseTemp !== undefined && onBaseTempChange && (
        <div className="gdd-base-control">
          <label htmlFor="gdd-base-temperature">Base temperature (Tbase)</label>
          <div>
            <input
              id="gdd-base-temperature"
              type="number"
              min="-50"
              max="50"
              step="0.1"
              value={baseTemp}
              onChange={(event) => onBaseTempChange(event.target.value)}
              aria-describedby="gdd-base-temperature-unit"
            />
            <span id="gdd-base-temperature-unit">°C</span>
          </div>
        </div>
      )}
    </article>
  );
}

function SoilPanel() {
  const [range, setRange] = useState<Range>("Today");
  const values: Record<Range, number[]> = {
    Today: [54, 56, 57, 56, 55, 54, 53, 55, 56, 56],
    "1 month": [62, 59, 57, 52, 49, 56, 61, 59, 54, 50, 53, 56],
    "6 months": [48, 53, 61, 65, 58, 51, 47, 55, 63, 60, 57, 56],
  };

  return (
    <aside className="soil-panel">
      <div className="soil-header">
        <div>
          <p className="eyebrow">Below the surface</p>
          <h2>Soil data</h2>
        </div>
        <span className="live-dot">
          <i /> Live
        </span>
      </div>

      <div className="soil-reading">
        <div className="moisture-ring" style={{ "--value": "56%" } as CSSProperties}>
          <div>
            <strong>
              56<span>%</span>
            </strong>
            <small>moisture</small>
          </div>
        </div>
        <div className="soil-status">
          <span>Optimal</span>
          <p>Soil moisture is in the ideal range for the current crop stage.</p>
        </div>
      </div>

      <div className="soil-chart-block">
        <div className="soil-chart-title">
          <h3>Moisture trend</h3>
          <span>30 cm depth</span>
        </div>
        <LineChart values={values[range]} color="#d1a326" />
        <div className="range-control soil-ranges" aria-label="Soil moisture date range">
          {ranges.map((item) => (
            <button
              key={item}
              type="button"
              className={range === item ? "active" : ""}
              onClick={() => setRange(item)}
              aria-pressed={range === item}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="soil-details">
        <div>
          <span>Field capacity</span>
          <strong>68%</strong>
        </div>
        <div>
          <span>Last reading</span>
          <strong>2 min ago</strong>
        </div>
        <div>
          <span>Sensor status</span>
          <strong className="connected">Connected</strong>
        </div>
      </div>
    </aside>
  );
}

const cropStages = [
  { name: "Germination", description: "Seeds absorb water and begin to sprout.", complete: true },
  { name: "Vegetative", description: "Roots, stems, and leaves develop rapidly.", current: true },
  { name: "Flowering", description: "Flower structures form and pollination begins." },
  { name: "Maturation", description: "Fruit and grain fill, ripen, and prepare for harvest." },
];

const periodDays: Record<Period, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  yearly: 365,
};

function AuthScreen({
  onAuthenticated,
  onSkip,
}: {
  onAuthenticated: () => void;
  onSkip: () => void;
}) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-up");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!supabase) {
      setError("Supabase is not configured. Add the VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.");
      return;
    }

    setSubmitting(true);
    const result = mode === "sign-up"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === "sign-up" && !result.data.session) {
      setMessage("Account created. Check your email to confirm your account, then sign in.");
      setMode("sign-in");
      return;
    }

    onAuthenticated();
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <img className="auth-logo" src="/LOGO.png" alt="ISL ASTRO-NOTS logo" />
        <p className="overline">Agricultural intelligence</p>
        <h1 id="auth-title">{mode === "sign-up" ? "Create your account" : "Welcome back"}</h1>
        <p className="auth-copy">
          {mode === "sign-up"
            ? "Create an account to access your farm dashboard."
            : "Sign in to continue to your farm dashboard."}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            type="password"
            minLength={6}
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="auth-feedback error" role="alert">{error}</p>}
          {message && <p className="auth-feedback" role="status">{message}</p>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? "Working…" : mode === "sign-up" ? "Create account" : "Sign in"}
          </button>
        </form>

        <button
          className="auth-toggle"
          type="button"
          onClick={() => {
            setMode(mode === "sign-up" ? "sign-in" : "sign-up");
            setError(null);
            setMessage(null);
          }}
        >
          {mode === "sign-up" ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>
        <button className="auth-skip" type="button" onClick={onSkip}>
          Continue without an account
        </button>
      </section>
    </main>
  );
}


function Dashboard({
  authenticated,
  onOpenAuth,
  onSignOut,
}: {
  authenticated: boolean;
  onOpenAuth: () => void;
  onSignOut: () => void;
}) {
  const [source, setSource] = useState<"map" | "data" | "lora" | "crop">("map");
  const [environmentView, setEnvironmentView] = useState<"weather" | "soil">("weather");
  const [farmLocation, setFarmLocation] =
    useState<FarmLocation | null>(null);
  const [period, setPeriod] = useState<Period>("daily");
  const [baseTempInput, setBaseTempInput] = useState("10");
  const parsedBaseTemp = Number(baseTempInput);
  const baseTemp = Number.isFinite(parsedBaseTemp) ? parsedBaseTemp : 10;

  // NASA POWER API integration
  const {
    days: weatherDays,
    loading: weatherLoading,
    error: weatherError,
  } = useFarmWeather(farmLocation, baseTemp);

  const latestWeather = summarizeWeather(weatherDays, periodDays[period]);
  const latestDay = weatherDays[weatherDays.length - 1];
  const chartStartDate = latestDay
    ? new Date(`${latestDay.date}T00:00:00Z`)
    : null;
  if (chartStartDate) {
    chartStartDate.setUTCDate(chartStartDate.getUTCDate() - periodDays[period] + 1);
  }
  const chartStart = chartStartDate?.toISOString().slice(0, 10);
  const chartDays = chartStart && latestDay
    ? weatherDays.filter((day) => day.date >= chartStart && day.date <= latestDay.date)
    : [];
  // Current date displayed in dashboard header
  const currentDate = new Date();

  const dayName = currentDate.toLocaleDateString("en-US", {
    weekday: "long",
  });

  const formattedDate = currentDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Show Location Data only when a farm has been selected
  const dataReady = source === "data" && farmLocation !== null;
  const weatherValues: Record<Metric["icon"], number | null> = {
    temperature: latestWeather?.temperature ?? null,
    rainfall: latestWeather?.rainfall ?? null,
    gdd: latestWeather?.gdd ?? null,
    humidity: latestWeather?.humidity ?? null,
    soil: null,
    health: null,
  };

  const activeMetrics: Metric[] = metrics.map((metric) => {
    const value = weatherValues[metric.icon];

    return {
      ...metric,
      chartValues: chartDays.map((day) => {
        if (metric.icon === "temperature") return day.temp_avg;
        if (metric.icon === "rainfall") return day.rain;
        if (metric.icon === "gdd") return day.cumulative_gdd;
        if (metric.icon === "humidity") return day.humidity;
        return 0;
      }),
      chartLabels: chartDays.length > 0
        ? chartDays.map((day) => day.date)
        : undefined,

      value: weatherLoading
        ? "..."
        : value !== null
          ? value.toFixed(1)
          : "—",

      change: weatherLoading
        ? "Loading NASA POWER data..."
        : weatherError
          ? `API error: ${weatherError}`
          : latestWeather
            ? `NASA POWER · ${latestWeather.latestDate}`
            : "No observation available",
    };
  });


  return (
    <main>
      <header className="page-header">
        <img className="brand-mark" src="/LOGO.png" alt="ISL ASTRO-NOTS logo" />
        <div className="title-block">
          <p className="overline">Agricultural intelligence</p>
          <h1>ISL ASTRO-NOTS</h1>
          <p className="subtitle">Field overview · Updated moments ago</p>
        </div>
        <nav className="source-nav" aria-label="Data sources">
          {([
            ["map", "Location Select"],
            ["data", "Location Data"],
            ["lora", "LoRa"],
            ["crop", "Crop Cycles"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`${source === value ? "active " : ""}${value === "data" && !farmLocation ? "disabled" : ""}`}
              aria-disabled={value === "data" && !farmLocation}
              onClick={() => {
                if (value !== "data" || farmLocation) setSource(value);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="header-meta">
          <span>{dayName}</span>
          <strong>{formattedDate}</strong>
          <button className="auth-header-button" type="button" onClick={authenticated ? onSignOut : onOpenAuth}>
            {authenticated ? "Sign out" : "Sign in / sign up"}
          </button>
        </div>
      </header>

      <section className="source-panel" aria-label="Choose a field data source">
        {source === "map" ? (
  <>
    <div className="source-panel-copy">
      <div>
        <p className="eyebrow">Field location</p>

        <h2>
          {farmLocation
            ? "Location selected"
            : "Select a location to begin"}
        </h2>

        <p>
          {farmLocation
            ? "Your farm location is selected. Choose Location data from the menu above to view the dashboard."
            : "Click anywhere on the map to select your farmland."}
        </p>
      </div>

      <span
        className={
          farmLocation
            ? "source-status ready"
            : "source-status"
        }
      >
        <i />
        {farmLocation
          ? "Location ready"
          : "Awaiting location"}
      </span>
    </div>

    <FarmMap
      value={farmLocation}
      onSelect={setFarmLocation}
    />
    {farmLocation && (
      <FieldDataPanel
        location={farmLocation}
        period={period}
        onPeriodChange={setPeriod}
        days={weatherDays}
        loading={weatherLoading}
        error={weatherError}
      />
    )}
  </>
        ) : source === "lora" ? (
          <LoRaDashboard />
        ) : source === "crop" ? (
          <div className="crop-cycle-placeholder">
            <p className="eyebrow">Crop cycles</p>
            <h2>Crop cycle planning</h2>
            <p>
              This space is reserved for crop-cycle planning and seasonal growth tracking.
            </p>
            <span className="source-status"><i /> Work in progress</span>
          </div>
        ) : (
          <div className="location-summary">
            <div className="location-summary-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 22s7-6.2 7-13A7 7 0 1 0 5 9c0 6.8 7 13 7 13Z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </div>
            <div>
              <p className="eyebrow">Selected location</p>
              <h2>{farmLocation.address ?? "Selected map pin"}</h2>
              <p>Live conditions and crop-cycle data for your selected field pin.</p>
            </div>
            <button type="button" onClick={() => setSource("map")}>
              Change location
            </button>
          </div>
        )}
      </section>

      {dataReady ? (
        <>
          <section className="environment-section" aria-label="Field conditions">
            <div className="weather-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Environment</p>
                  <h2>Growing conditions</h2>
                </div>
                <div className="section-period-selector">
                  <span>Data period</span>
                  <PeriodSelector
                    period={period}
                    onPeriodChange={setPeriod}
                    compact
                  />
                </div>
              </div>
              <div className="environment-tabs" aria-label="Environment data type">
                <button
                  type="button"
                  className={environmentView === "weather" ? "active" : ""}
                  onClick={() => setEnvironmentView("weather")}
                  aria-pressed={environmentView === "weather"}
                >
                  Weather data
                </button>
                <button
                  type="button"
                  className={environmentView === "soil" ? "active" : ""}
                  onClick={() => setEnvironmentView("soil")}
                  aria-pressed={environmentView === "soil"}
                >
                  Soil &amp; water data
                </button>
              </div>
              <div className="metric-grid">
                {(environmentView === "weather"
                  ? activeMetrics.filter((metric) => metric.title !== "Humidity")
                  : soilWaterMetrics
                ).map((metric) => (
                  <MetricCard
                    key={metric.title}
                    metric={metric}
                    period={period}
                    baseTemp={metric.icon === "gdd" ? baseTempInput : undefined}
                    onBaseTempChange={metric.icon === "gdd" ? setBaseTempInput : undefined}
                  />
                ))}
              </div>
            </div>
          </section>
        </>
      ) : (
        <div className="data-waiting">
          <span />
          <p>
            {source === "map"
              ? farmLocation
                ? "Location saved. Choose “Location data” above to view the field dashboard."
                : "Field data will appear after you place a location pin."
              : "Field data will appear after a LoRa device is connected."}
          </p>
        </div>
      )}
    </main>
  );
}

export default function App() {
  const [sessionReady, setSessionReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setSessionReady(true);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setAuthenticated(Boolean(data.session));
      setSessionReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(Boolean(session));
      setSessionReady(true);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (!sessionReady) return null;

  async function handleSignOut() {
    await supabase?.auth.signOut();
    setAuthenticated(false);
  }

  return (
    <>
      <Dashboard
        authenticated={authenticated}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={handleSignOut}
      />
      {authOpen && (
        <div className="auth-modal-backdrop">
          <AuthScreen
            onAuthenticated={() => {
              setAuthenticated(true);
              setAuthOpen(false);
            }}
            onSkip={() => setAuthOpen(false)}
          />
        </div>
      )}
    </>
  );
}
