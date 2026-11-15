import { useEffect, useState } from "react";
import "./LoRaDashboard.css";
import { apiUrl } from "./api";

// The FastAPI backend reads this from the bridge's local status file.
// Keeping the Supabase key and USB serial access out of React.
type LoRaEvent = { at: string; message: string };

type LoRaStatus = {
  bridge_running: boolean;
  main_connected: boolean;
  main_port: string | null;
  weather_cached: boolean;
  cached_packet: string | null;
  cache_updated_at: string | null;
  last_request_at: string | null;
  last_reply_tx_at: string | null;
  last_reply_status: "none" | "request_received" | "sending" | "transmitted" | "failed";
  last_error: string | null;
  updated_at: string | null;
  events: LoRaEvent[];
  last_push_status?: string;
  last_push_tx_at?: string | null;
  last_farmer_ack_at?: string | null;
  manual_send?: {
    request_id: string;
    state: "queued" | "sending" | "transmitting" | "delivered" | "unconfirmed" | "failed";
    requested_at: string | null;
    completed_at: string | null;
    packet?: string;
    error: string | null;
  } | null;
};

type WeatherPacket = {
  date: string;
  temperature: string;
  gdd: string;
  rain: string;
};

function parsePacket(packet: string | null): WeatherPacket | null {
  if (!packet) return null;
  const match = /^SEQ=\d+,D=(\d{8}),G10=(-?\d+),T10=(-?\d+),R=([01]),SM=NA$/.exec(packet);
  if (!match) return null;

  const [, date, gdd, temp, rain] = match;
  return {
    date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`,
    temperature: `${(Number(temp) / 10).toFixed(1)} °C`,
    gdd: (Number(gdd) / 10).toFixed(1),
    rain: rain === "1" ? "YES" : "NO",
  };
}

function formatTime(value: string | null): string {
  if (!value) return "Not recorded yet";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "Unknown" : timestamp.toLocaleString();
}

export default function LoRaDashboard() {
  const [status, setStatus] = useState<LoRaStatus | null>(null);
  const [error, setError] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendNotice, setSendNotice] = useState("");
  const [pendingSendId, setPendingSendId] = useState("");

  useEffect(() => {
    let mounted = true;

    async function refresh() {
      try {
        const response = await fetch(apiUrl("/api/lora/status"), {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: LoRaStatus = await response.json();
        if (mounted) {
          setStatus(data);
          setError("");
        }
      } catch {
        if (mounted) {
          setError("Cannot reach FastAPI on port 8000");
          setStatus(null);
        }
      }
    }

    refresh();
    const interval = window.setInterval(refresh, 4000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  // The browser queues a request through FastAPI; the bridge owns USB serial.
  async function sendLatestWeather() {
    setSendBusy(true);
    setSendNotice("");
    try {
      const response = await fetch(apiUrl("/api/lora/send"), {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? `HTTP ${response.status}`);
      setPendingSendId(result.request_id);
      setSendNotice("Push queued. Waiting for farmer's radio acknowledgment...");
    } catch (err) {
      setSendNotice(err instanceof Error ? err.message : "Could not queue LoRa send");
    } finally {
      setSendBusy(false);
    }
  }

  const bridgeOnline = Boolean(status?.bridge_running);
  const mainOnline = bridgeOnline && Boolean(status?.main_connected);
  const weather = mainOnline && status?.weather_cached
    ? parsePacket(status.cached_packet)
    : null;
  const manual = status?.manual_send;
  const waitingForLatestSend = Boolean(pendingSendId && manual?.request_id !== pendingSendId);
  const queuedOrSending = waitingForLatestSend || manual?.state === "queued" || manual?.state === "sending" || manual?.state === "transmitting";
  const replySent = status?.last_reply_status === "transmitted";
  const replyFailed = status?.last_reply_status === "failed";

  return (
    <div className="lora-dashboard">
      <div className="lora-dashboard-heading">
        <div>
          <p className="eyebrow">Direct field connection</p>
          <h2>LoRa Point to Point</h2>
          <p>Send the latest NASA POWER weather straight to the farmer, or use the PRG button to request it.</p>
        </div>
        <span className={`source-status ${mainOnline ? "ready" : ""}`}>
          <i /> {mainOnline ? "Main connected" : bridgeOnline ? "Main offline" : "Bridge offline"}
        </span>
      </div>

      <div className="lora-device-flow">
        <div className="lora-device-card">
          <span className="lora-device-role">Main station · USB</span>
          <strong>Heltec V4 · Base station</strong>
          <small>{mainOnline ? `Connected on ${status?.main_port}` : "Waiting for main Heltec USB"}</small>
          <small>Stores Supabase weather and transmits on demand</small>
        </div>
        <div className="lora-flow-arrow" aria-hidden="true">↔</div>
        <div className="lora-device-card">
          <span className="lora-device-role">Farmer station · Battery</span>
          <strong>Heltec V4 · LCD2004</strong>
          <small>{status?.last_request_at ? `Last request: ${formatTime(status.last_request_at)}` : "No request observed yet"}</small>
          <small>Receives dashboard pushes automatically; PRG still works</small>
        </div>
      </div>

      <section className="lora-manual-card" aria-labelledby="lora-manual-heading">
        <div>
          <p className="eyebrow">Manual dispatch</p>
          <h3 id="lora-manual-heading">Send latest weather to farmer Heltec</h3>
          <p>Sends the latest Supabase reading through the main Heltec over LoRa. The farmer LCD updates automatically, without pressing PRG.</p>
          {manual && (
            <p className={manual.state === "failed" || manual.state === "unconfirmed" ? "lora-error" : "lora-manual-state"}>
              {manual.state === "queued" ? "Queued for bridge" :
               manual.state === "sending" ? "Fetching weather and sending to main" :
               manual.state === "transmitting" ? "Main transmitting; waiting for farmer ACK" :
               manual.state === "delivered" ? "Delivered: farmer Heltec acknowledged packet" :
               manual.state === "unconfirmed" ? `Transmission unconfirmed: ${manual.error ?? "No ACK"}` :
               `Send failed: ${manual.error ?? "Unknown error"}`}
              {manual.completed_at && ` · ${formatTime(manual.completed_at)}`}
            </p>
          )}
          {sendNotice && (!pendingSendId || manual?.request_id !== pendingSendId) && (
            <p className="lora-manual-state" role="status">{sendNotice}</p>
          )}
        </div>
        <button
          className="lora-send-button"
          type="button"
          onClick={sendLatestWeather}
          disabled={!mainOnline || sendBusy || queuedOrSending}
        >
          {sendBusy || queuedOrSending ? "Sending..." : "Send weather to farmer"}
        </button>
      </section>

      <div className="lora-content-grid">
        <section className="lora-data-card" aria-labelledby="lora-data-heading">
          <div className="lora-card-heading">
            <div>
              <p className="eyebrow">Main station cache</p>
              <h3 id="lora-data-heading">Weather ready for LoRa</h3>
            </div>
            <span className="lora-packet-status">{weather?.date ?? "No cached reading"}</span>
          </div>
          <div className="lora-sensor-grid">
            <div><span>Temperature</span><strong>{weather?.temperature ?? "—"}</strong></div>
            <div><span>Rain observed</span><strong>{weather?.rain ?? "—"}</strong></div>
            <div><span>Daily GDD</span><strong>{weather?.gdd ?? "—"}</strong></div>
            <div><span>Soil moisture</span><strong>N/A</strong></div>
            <div><span>Humidity</span><strong>Not sent</strong></div>
          </div>
          <p className="lora-placeholder-note">
            {weather
              ? `Last cache confirmation: ${formatTime(status?.cache_updated_at ?? null)}. Rain is YES/NO in the current LoRa packet.`
              : "Waiting for a confirmed weather packet from the main Heltec."}
          </p>
        </section>

        <section className="lora-handshake-card" aria-labelledby="lora-handshake-heading">
          <div className="lora-card-heading">
            <div>
              <p className="eyebrow">Communication sequence</p>
              <h3 id="lora-handshake-heading">Request and reply</h3>
            </div>
            <span className={`lora-link-state ${replySent ? "is-success" : replyFailed ? "is-error" : ""}`}>
              {replySent ? "Reply transmitted" : replyFailed ? "TX failed" : status?.last_reply_status === "sending" ? "Sending" : "Waiting"}
            </span>
          </div>
          <ol className="lora-handshake-list">
            <li><i className={status?.last_request_at ? "lora-event-dot" : "lora-event-dot muted"} />Farmer request seen: {formatTime(status?.last_request_at ?? null)}</li>
            <li><i className={replySent ? "lora-event-dot" : "lora-event-dot muted"} />Main transmit completed: {formatTime(status?.last_reply_tx_at ?? null)}</li>
            <li><i className="lora-event-dot muted" />PRG-request reception: no separate ACK sent</li>
          </ol>
          <p className="lora-received-note">Manual delivery is confirmed only when the farmer's radio sends an ACK. A PRG reply is transmission-only.</p>
          <ol className="lora-handshake-list">
            <li><i className={status?.last_push_tx_at ? "lora-event-dot" : "lora-event-dot muted"} />Last dashboard push transmitted: {formatTime(status?.last_push_tx_at ?? null)}</li>
            <li><i className={status?.last_farmer_ack_at ? "lora-event-dot" : "lora-event-dot muted"} />Farmer ACK received: {formatTime(status?.last_farmer_ack_at ?? null)}</li>
          </ol>
          {status?.last_error && <p className="lora-error">Bridge issue: {status.last_error}</p>}
          {error && <p className="lora-error">{error}</p>}
        </section>
      </div>

      <section className="lora-activity" aria-label="Recent LoRa events">
        <div className="lora-card-heading">
          <div>
            <p className="eyebrow">Bridge activity</p>
            <h3>Recent events</h3>
          </div>
          <span className="lora-packet-status">Auto refresh · 4 seconds</span>
        </div>
        {status?.events?.length ? (
          <ul className="lora-event-list">
            {status.events.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <span>{event.message}</span>
                <time>{formatTime(event.at)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="lora-placeholder-note">No radio activity yet. Press PRG or send weather from this tab.</p>
        )}
      </section>
    </div>
  );
}
