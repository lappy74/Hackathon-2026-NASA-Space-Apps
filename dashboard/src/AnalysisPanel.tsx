// =============================================================================
// AnalysisPanel.tsx  --  THIS IS A BRAND NEW FILE.
// WHERE TO PUT IT: in your src folder, right next to App.tsx and FarmMap.tsx.
// =============================================================================

import { useEffect, useState } from "react"; // useState remembers values; useEffect runs code when something changes
import type { FarmLocation } from "./FarmMap"; // the shape of the selected location (latitude, longitude, radiusMiles)

// Where the Python server lives. If VITE_API_URL is not set in .env, use the local address.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000"; // the web address of the Python server

// ---------- Types: they describe the shape of the data the server sends back ----------

type Status = "good" | "watch" | "alert" | "unknown"; // the four possible status words

type NoticeLine = { // one small sub-line inside a notice (used for cool-season and warm-season temperatures)
  label: string; // the line's name, such as "Warm-season crops"
  status: Status; // its status, which sets the colored dot
  text: string; // the sentence to show
};

type Notice = { // one notice card (soil, temperature, or satellite)
  key: string; // a unique id for the card
  title: string; // the card heading, such as "Soil moisture"
  status: Status; // the card's status
  label: string; // the short text in the colored pill, such as "Marginal"
  message: string; // the main sentence
  lines: NoticeLine[]; // optional sub-lines (can be an empty list)
  reminder: string; // reminder text such as "Notice: May need to inspect field" (empty if none)
};

type AnalysisPayload = { // everything the server sends in one package
  overall: { status: Status; headline: string }; // the top summary
  area: { radius_miles: number; acres: number }; // the size of the selected area
  notices: Notice[]; // the list of notice cards
  notes: string[]; // the fine print
};

// ---------- Small helper tools ----------

function isoDate(d: Date) { // turns a Date into text like "2026-11-15"
  return d.toISOString().slice(0, 10); // keep only the year-month-day part
}

function analysisWindow() { // decides which dates to analyze: the last 90 days, ending 3 days ago
  const end = new Date(); // start from right now
  end.setDate(end.getDate() - 3); // go back 3 days because NASA data lags a few days behind
  const start = new Date(end); // copy the end date
  start.setDate(start.getDate() - 90); // go back another 90 days to get the start
  return { start: isoDate(start), end: isoDate(end) }; // give both dates back as text
}

function useDebounced<T>(value: T, delay: number) { // waits until a value stops changing before passing it on
  const [settled, setSettled] = useState(value); // the value we pass on, starting as the current value
  useEffect(() => { // runs every time the incoming value changes
    const timer = setTimeout(() => setSettled(value), delay); // after "delay" ms with no change, accept the new value
    return () => clearTimeout(timer); // if the value changes again first, cancel the wait and start over
  }, [value, delay]); // only re-run when the value or delay changes
  return settled; // hand back the settled value
}

// ---------- The hook that fetches the analysis ----------
// A "hook" is a reusable function that holds state and runs side effects inside a component.

function useAreaAnalysis(location: FarmLocation | null) { // fetches the analysis whenever the selected area changes
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null); // the data from the server (null until it arrives)
  const [fetching, setFetching] = useState(false); // true while a request is in progress
  const [error, setError] = useState<string | null>(null); // an error message, or null if all is well

  const key = location // build a short text "fingerprint" of the selected area
    ? [
        location.latitude.toFixed(4), // latitude, 4 decimals (about 11 meters)
        location.longitude.toFixed(4), // longitude, 4 decimals
        (location.radiusMiles ?? 1).toFixed(1), // radius in miles, 1 decimal (1 if it is missing)
      ].join(",") // glue the three numbers together with commas
    : ""; // no location selected means an empty fingerprint

  const settledKey = useDebounced(key, 800); // wait 0.8 seconds after the last change (so dragging the radius slider does not spam the server)
  const waiting = key !== settledKey; // true during that short wait

  useEffect(() => { // runs whenever the settled fingerprint changes
    if (!settledKey) { // no location selected
      setAnalysis(null); // clear any old result
      setError(null); // clear any old error
      setFetching(false); // nothing is loading
      return; // stop here
    }

    const [lat, lon, radius] = settledKey.split(","); // split the fingerprint back into its three pieces
    const { start, end } = analysisWindow(); // get the date range
    const query = new URLSearchParams({ lat, lon, radius_miles: radius, start, end }); // build "?lat=..&lon=..&radius_miles=.." safely
    const controller = new AbortController(); // lets us cancel this request if the area changes again

    setFetching(true); // show the loading message
    setError(null); // forget any earlier error

    fetch(`${API_URL}/api/analysis?${query}`, { signal: controller.signal }) // ask the Python server for the analysis
      .then(async (res) => { // when the server answers
        if (!res.ok) { // the server answered with an error code
          const body = await res.json().catch(() => null); // try to read its error message
          throw new Error(body?.detail ?? `Request failed (${res.status})`); // use that message, or a generic one
        }
        return res.json() as Promise<AnalysisPayload>; // otherwise read the JSON data
      })
      .then((data) => setAnalysis(data)) // save the data so the screen updates
      .catch((err) => { // if anything went wrong
        if (err?.name === "AbortError") return; // we cancelled it on purpose, so ignore it
        setAnalysis(null); // drop old data
        setError( // save a friendly message
          err instanceof TypeError
            ? "Can't reach the analysis server. Make sure the Python server is running." // the server is off or unreachable
            : err.message // otherwise show the server's own message
        );
      })
      .finally(() => { // after success or failure
        if (!controller.signal.aborted) setFetching(false); // hide the loading message (unless this request was cancelled)
      });

    return () => controller.abort(); // if the area changes again, cancel this request
  }, [settledKey]); // run again only when the settled fingerprint changes

  return { analysis, loading: fetching || waiting, error }; // give the component what it needs
}

// ---------- Text shown in the top-right badge for each overall status ----------

const BADGE_TEXT: Record<Status, string> = { // a lookup table: status word -> badge words
  good: "Nothing flagged", // everything looks fine
  watch: "Flagged", // something is worth a look
  alert: "Flagged", // something is more serious
  unknown: "Not enough data", // data is missing
};

// ---------- The component that draws everything ----------

export default function AnalysisPanel({ location }: { location: FarmLocation | null }) { // location comes from App.tsx
  const { analysis, loading, error } = useAreaAnalysis(location); // fetch the analysis for this location

  return ( // what the component draws
    <div className="analysis-wrap">
      {/* Header row: title on the left, status badge on the right */}
      <div className="analysis-header">
        <div>
          {/* Small gold label above the title */}
          <p className="eyebrow">Crop cycles</p>
          {/* The panel title */}
          <h2>Field status</h2>
          {/* A line under the title that shows the selected area size once the data arrives */}
          <p className="analysis-sub">
            {analysis
              ? `Selected area: ${analysis.area.radius_miles.toFixed(1)} mile radius (about ${analysis.area.acres.toLocaleString()} acres).`
              : "Analysis of the area you selected on the map."}
          </p>
        </div>
        {/* The overall badge, shown only when we have data. Its color comes from the status word. */}
        {analysis && !loading && (
          <span className={`analysis-badge ${analysis.overall.status}`}>
            {BADGE_TEXT[analysis.overall.status]}
          </span>
        )}
      </div>

      {/* Case 1: no location has been selected yet */}
      {!location ? (
        <p className="analysis-message-box">Select a location on the Location Select tab to see the analysis.</p>
      ) : /* Case 2: the server reported an error */ error ? (
        <p className="analysis-message-box error">{error}</p>
      ) : /* Case 3: still loading (or waiting for the radius slider to stop moving) */ loading || !analysis ? (
        <p className="analysis-message-box">Reading soil, weather and satellite data for your selected area. The satellite step can take up to a minute.</p>
      ) : (
        /* Case 4: we have the analysis, so show it */
        <>
          {/* The one-sentence summary at the top */}
          <p className="analysis-headline">{analysis.overall.headline}</p>

          {/* The grid of notice cards. .map() makes one card for each notice in the list. */}
          <div className="analysis-grid">
            {analysis.notices.map((notice) => (
              // "key" helps React keep track of each card
              <article key={notice.key} className="analysis-notice">
                {/* Card top row: the title and the colored pill */}
                <div className="analysis-notice-top">
                  <h3>{notice.title}</h3>
                  {/* The pill's color comes from the status word (good, watch, alert, unknown) */}
                  <span className={`analysis-pill ${notice.status}`}>{notice.label}</span>
                </div>

                {/* The main sentence for this notice */}
                <p className="analysis-message">{notice.message}</p>

                {/* Sub-lines (only the temperature notice has these) */}
                {notice.lines.length > 0 && (
                  <ul className="analysis-lines">
                    {notice.lines.map((line) => (
                      <li key={line.label}>
                        {/* A small colored dot showing this line's status */}
                        <i className={`analysis-dot ${line.status}`} />
                        <div>
                          {/* The line's name, such as "Warm-season crops" */}
                          <strong>{line.label}</strong>
                          {/* The sentence describing it */}
                          <span>{line.text}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* The reminder is shown only when the server sent one (when something is flagged) */}
                {notice.reminder && <p className="analysis-reminder">{notice.reminder}</p>}
              </article>
            ))}
          </div>

          {/* The fine print at the bottom */}
          <ul className="analysis-notes">
            {analysis.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
