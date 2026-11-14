import { useId, useState } from "react";
import FarmMap, { type FarmLocation } from "./FarmMap";

type Range = "Today" | "1 month" | "6 months";

type Metric = {
  title: string;
  value: string;
  unit: string;
  change: string;
  color: string;
  softColor: string;
  icon: "temperature" | "rainfall" | "gdd" | "humidity";
  data: Record<Range, number[]>;
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
  return (
    <svg {...common} aria-hidden="true">
      <path d="M12 2.8S5.5 10.1 5.5 15a6.5 6.5 0 0 0 13 0C18.5 10.1 12 2.8 12 2.8Z" />
      <path d="M9 16.5a3.2 3.2 0 0 0 3 1.8" />
    </svg>
  );
}

function LineChart({ values, color }: { values: number[]; color: string }) {
  const id = useId().replace(/:/g, "");
  const width = 480;
  const height = 112;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 12 - ((value - min) / spread) * 82;
    return [x, y];
  });
  const line = points.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;

  return (
    <div className="chart" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".24" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[26, 58, 90].map((y) => (
          <line key={y} x1="0" y1={y} x2={width} y2={y} className="grid-line" />
        ))}
        <path d={area} fill={`url(#${id})`} />
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

function MetricCard({ metric }: { metric: Metric }) {
  const [range, setRange] = useState<Range>("Today");

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
        <div className="range-control" aria-label={`${metric.title} date range`}>
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
      <div className="metric-content">
        <div className="reading">
          <p>
            {metric.value}
            <span>{metric.unit}</span>
          </p>
          <small>{metric.change}</small>
        </div>
        <LineChart values={metric.data[range]} color={metric.color} />
      </div>
      <div className="chart-labels">
        <span>{range === "Today" ? "6 AM" : range === "1 month" ? "May 01" : "Dec"}</span>
        <span>{range === "Today" ? "Now" : range === "1 month" ? "May 31" : "May"}</span>
      </div>
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
        <div className="moisture-ring" style={{ "--value": "56%" } as React.CSSProperties}>
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

export default function App() {
  const [source, setSource] = useState<"map" | "data" | "lora">("map");
  const [farmLocation, setFarmLocation] =
  useState<FarmLocation | null>(null);

  const dataReady = source === "data" && farmLocation !== null;

  const today = new Date();
  const dayName = today.toLocaleDateString("en-US", { weekday: "long" });
  const formattedDate = today.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main>
      <header className="page-header">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="title-block">
          <p className="overline">Agricultural intelligence</p>
          <h1>ISL ASTRO-NOTS</h1>
          <p className="subtitle">Field overview · Updated moments ago</p>
        </div>
        <label className="source-select">
          <span>Data source</span>
          <div>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" />
              <circle cx="12" cy="10" r="2" />
            </svg>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as "map" | "data" | "lora")}
            >
              <option value="map">Map location</option>
              <option value="data" disabled={!farmLocation}>
                Location data
              </option>
              <option value="lora">LoRa Point to Point</option>
            </select>
            <svg className="select-chevron" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m8 10 4 4 4-4" />
            </svg>
          </div>
        </label>
        <div className="header-meta">
          <span>{dayName}</span>
          <strong>{formattedDate}</strong>
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
  </>
        ) : source === "lora" ? (
          <div className="lora-placeholder">
            <div className="lora-visual" aria-hidden="true">
              <span className="lora-node node-left">
                <i />
              </span>
              <span className="signal-line line-one" />
              <span className="signal-line line-two" />
              <span className="signal-line line-three" />
              <span className="lora-node node-right">
                <i />
              </span>
            </div>
            <div>
              <p className="eyebrow">Direct field connection</p>
              <h2>LoRa Point to Point</h2>
              <p>
                This space is reserved for pairing a LoRa field node. Device discovery and live
                sensor transfer can be connected here later.
              </p>
              <span className="source-status">
                <i /> Integration pending
              </span>
            </div>
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
              <h2>Field 01 · North paddock</h2>
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
          <section className="dashboard-grid" aria-label="Field conditions">
            <div className="weather-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Environment</p>
                  <h2>Growing conditions</h2>
                </div>
                <p>Selected field location</p>
              </div>
              <div className="metric-grid">
                {metrics.map((metric) => (
                  <MetricCard key={metric.title} metric={metric} />
                ))}
              </div>
            </div>
            <SoilPanel />
          </section>

          <section className="crop-cycle">
            <div className="cycle-heading">
              <p className="eyebrow">Season progress</p>
              <h2>Current crop cycle</h2>
              <p>
                Your crop is currently in the <strong>vegetative stage</strong>, focused on
                establishing a strong canopy and root system.
              </p>
            </div>
            <div className="cycle-track">
              <div className="track-line" />
              {cropStages.map((stage, index) => (
                <article
                  key={stage.name}
                  className={`cycle-stage ${stage.current ? "current" : ""} ${stage.complete ? "complete" : ""}`}
                >
                  <div className="stage-marker">
                    {stage.complete ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m7 12 3.2 3.2L17.5 8" />
                      </svg>
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>
                  <p>
                    {stage.current ? "Current stage" : stage.complete ? "Completed" : "Upcoming"}
                  </p>
                  <h3>{stage.name}</h3>
                  <small>{stage.description}</small>
                </article>
              ))}
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
