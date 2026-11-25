import { Link } from "@tanstack/react-router";
import { HOURS, STORE } from "../lib/store-info";

function trackContact(event: "phone_click" | "directions_click") {
  if (typeof window === "undefined") return;
  const analytics = window as Window & { gtag?: (...args: unknown[]) => void };
  try {
    analytics.gtag?.("event", event, {
      send_to: "G-MJFFH0G7VF",
      contact_location: "store_info",
      transport_type: "beacon",
    });
  } catch {
    /* Tracking must not block navigation. */
  }
}

export function StoreInfo() {
  return (
    <address
      className="store-info mt-7 not-italic leading-relaxed text-slate-300"
      suppressHydrationWarning
    >
      <strong className="text-base font-semibold text-slate-100">{STORE.name}</strong>
      <br />
      {STORE.address.street}
      <br />
      {STORE.address.city}, {STORE.address.region} {STORE.address.postalCode}
      <br />
      <a
        href={`tel:${STORE.telephone}`}
        className="text-cyan-300 underline decoration-cyan-400/50 underline-offset-4 transition hover:text-cyan-200"
        onClick={() => trackContact("phone_click")}
      >
        {STORE.telephoneDisplay}
      </a>
      {" · "}
      <a
        href={STORE.mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-cyan-300 underline decoration-cyan-400/50 underline-offset-4 transition hover:text-cyan-200"
        onClick={() => trackContact("directions_click")}
      >
        Get directions
      </a>
      <ul className="mt-3 list-none space-y-1 p-0 text-sm text-slate-400">
        {HOURS.map((h) => (
          <li key={h.label}>
            <span className="text-slate-300">{h.label}:</span> {h.display}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
        <Link
          to="/cooler-door"
          className="font-medium text-cyan-300 underline decoration-cyan-400/50 underline-offset-4 transition hover:text-cyan-200"
        >
          Cooler Door — browse products &amp; prices
        </Link>
        <span className="text-slate-600" aria-hidden="true">
          ·
        </span>
        <Link
          to="/brands"
          className="font-medium text-cyan-300 underline decoration-cyan-400/50 underline-offset-4 transition hover:text-cyan-200"
        >
          Alcohol brand logos folder
        </Link>
      </div>
    </address>
  );
}
