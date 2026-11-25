import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "../components/brand-logo";
import { KegModal } from "../components/KegModal";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { StoreInfo } from "../components/StoreInfo";
import { STORE } from "../lib/store-info";
import "../home-refresh.css";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({ links: [{ rel: "canonical", href: `${STORE.url}/` }] }),
});

const trends = [
  {
    label: "Ready to enjoy",
    title: "Cocktails, without the prep",
    desc: "Explore ready-to-drink seltzers, teas, and canned cocktails for your next get-together. Check current flavors and prices in our Cooler Door.",
    category: "RTD",
    cta: "Browse RTD selection",
  },
  {
    label: "Beer & spirits",
    title: "The familiar and the local",
    desc: "Browse familiar domestic favorites, crisp imports, and Hawaii island brews. Always kept cold and ready to grab.",
    category: "Beer",
    cta: "Browse cold beer",
  },
  {
    label: "Something different",
    title: "Your next favorite",
    desc: "Curious about a new bottle of spirits, wine, or mixer? Browse our full Cooler Door catalog or ask our team what is new on the shelves.",
    category: "All",
    cta: "Open full Cooler Door",
  },
] as const;

const popularBrands = [
  { name: "Heineken", category: "Import beer" },
  { name: "Corona Extra", category: "Import beer" },
  { name: "Modelo Especial", category: "Import beer" },
  { name: "Coors Light", category: "Domestic beer" },
  { name: "Coors Banquet", category: "Domestic beer" },
  { name: "Bud Light", category: "Domestic beer" },
  { name: "Budweiser", category: "Domestic beer" },
  { name: "Michelob ULTRA", category: "Domestic beer" },
  { name: "Miller Lite", category: "Domestic beer" },
  { name: "Stella Artois", category: "Import beer" },
  { name: "Guinness", category: "Import beer" },
  { name: "Sapporo", category: "Import beer" },
  { name: "Kona Brewing", category: "Hawaii beer" },
  { name: "Maui Brewing", category: "Hawaii beer" },
  { name: "White Claw", category: "Hard seltzer" },
  { name: "Truly", category: "Hard seltzer" },
  { name: "High Noon", category: "Ready-to-drink" },
  { name: "Twisted Tea", category: "Ready-to-drink" },
  { name: "Crown Royal", category: "Whisky" },
  { name: "Tito's Handmade Vodka", category: "Vodka" },
  { name: "Don Julio", category: "Tequila" },
  { name: "Casamigos", category: "Tequila" },
  { name: "Patrón", category: "Tequila" },
  { name: "Jameson", category: "Irish whiskey" },
  { name: "Fireball", category: "Whisky" },
  { name: "Smirnoff Ice", category: "Ready-to-drink" },
  { name: "Suntory -196", category: "Ready-to-drink" },
  { name: "Surfside", category: "Ready-to-drink" },
  { name: "Monaco Cocktails", category: "Ready-to-drink" },
] as const;

function Home() {
  const [showKeg, setShowKeg] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const [motionPaused, setMotionPaused] = useState(false);
  const [brandIndex, setBrandIndex] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);

  const openKegModal = (opener: HTMLElement | null) => {
    openerRef.current = opener;
    setShowKeg(true);
  };

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      if (!motionPaused && !carouselPaused && !preference.matches && !document.hidden) {
        timer = setInterval(
          () => setBrandIndex((index) => (index + 1) % popularBrands.length),
          8000,
        );
      }
    };
    start();
    preference.addEventListener("change", start);
    document.addEventListener("visibilitychange", start);
    return () => {
      stop();
      preference.removeEventListener("change", start);
      document.removeEventListener("visibilitychange", start);
    };
  }, [motionPaused, carouselPaused]);

  return (
    <div className={"store-refresh" + (motionPaused ? " motion-paused" : "")}>
      <a className="skip-link" href="#top">
        Skip to content
      </a>

      <SiteHeader onOpenKegModal={openKegModal} />

      <main>
        <section id="top" tabIndex={-1} className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Honolulu · University Area · 21+</p>
            <h1>
              Your neighborhood
              <br />
              <em>stop for good drinks.</em>
            </h1>
            <p className="lead">
              From a familiar favorite to something new, explore cold beer, spirits, and
              ready-to-drink cocktails at 777 Liquor in Honolulu. Browse live Cooler Door pricing or
              ask us about a keg for your next gathering.
            </p>
            <div className="actions">
              <Link to="/cooler-door" className="button">
                Open Cooler Door <span aria-hidden="true">→</span>
              </Link>
              <Link to="/brands" className="button secondary">
                Brand logos folder
              </Link>
              <a className="text-link" href="#kegs">
                Ask about a keg →
              </a>
            </div>
          </div>

          <div className="hero-card beverage-scene">
            <svg
              viewBox="0 0 420 330"
              width="420"
              height="330"
              aria-hidden="true"
              focusable="false"
            >
              <ellipse cx="210" cy="295" rx="165" ry="15" fill="#22d3ee" opacity="0.14" />
              <g className="drink-float bottle">
                <rect x="180" y="30" width="32" height="24" rx="5" fill="#0e7490" />
                <path
                  d="M184 54h24v48l25 30v129q0 14-14 14h-48q-14 0-14-14V132l27-30z"
                  fill="#0891b2"
                />
                <rect
                  x="157"
                  y="153"
                  width="76"
                  height="77"
                  rx="8"
                  fill="#0b1220"
                  stroke="#22d3ee"
                  strokeWidth="1.5"
                />
                <text
                  x="195"
                  y="196"
                  textAnchor="middle"
                  fill="#e2e8f0"
                  fontSize="11"
                  fontWeight="700"
                  letterSpacing="1"
                >
                  SPIRITS
                </text>
              </g>
              <g className="drink-float beer">
                <rect x="56" y="124" width="83" height="151" rx="17" fill="#38bdf8" />
                <ellipse cx="97" cy="128" rx="39" ry="8" fill="#bae6fd" />
                <rect x="66" y="177" width="63" height="63" rx="6" fill="#0b1220" />
                <text
                  x="97"
                  y="213"
                  textAnchor="middle"
                  fill="#38bdf8"
                  fontSize="14"
                  fontWeight="700"
                  letterSpacing="1"
                >
                  BEER
                </text>
              </g>
              <g className="drink-float rtd">
                <rect x="265" y="138" width="78" height="137" rx="16" fill="#22d3ee" />
                <ellipse cx="304" cy="142" rx="36" ry="8" fill="#cffafe" />
                <circle cx="304" cy="210" r="27" fill="#0b1220" />
                <text
                  x="304"
                  y="215"
                  textAnchor="middle"
                  fill="#22d3ee"
                  fontSize="14"
                  fontWeight="700"
                  letterSpacing="1"
                >
                  RTD
                </text>
              </g>
            </svg>
            <p className="scene-note">Cold Beer · Spirits · Ready-to-Drink</p>
            <button
              type="button"
              className="motion-control"
              aria-pressed={motionPaused}
              onClick={() => setMotionPaused((value) => !value)}
            >
              {motionPaused ? "Resume animations" : "Pause animations"}
            </button>
          </div>
        </section>

        <section id="trending" className="section trends">
          <div className="section-head">
            <div>
              <p className="eyebrow">Something for every occasion</p>
              <h2>
                Find a favorite.
                <br />
                <span>Try something new.</span>
              </h2>
            </div>
            <p>
              Keeping it simple: cold beer from the cooler door, a bottle to share, or a
              ready-to-drink cocktail. Check current pricing online or stop by in Honolulu.
            </p>
          </div>
          <div className="trend-grid">
            {trends.map((item, i) => (
              <article className="trend" key={item.title}>
                <div className="num">0{i + 1}</div>
                <p className="eyebrow">{item.label}</p>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
                <Link
                  to="/cooler-door"
                  search={item.category === "All" ? {} : { category: item.category }}
                  className="scan"
                >
                  {item.cta} <span aria-hidden="true">↗</span>
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section id="beer" className="popular section">
          <div className="section-head">
            <div>
              <p className="eyebrow">Linked brand logos · Beer, spirits &amp; RTD</p>
              <h2>
                Familiar names.
                <br />
                <span>Fresh possibilities.</span>
              </h2>
            </div>
            <div className="flex flex-col items-start gap-4">
              <p className="section-head-copy">
                Brand logos below load directly from our local alcohol brand logos folder. Browse
                featured names here or open the full directory.
              </p>
              <Link
                to="/brands"
                className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 underline decoration-cyan-400/50 underline-offset-4 transition hover:text-cyan-200"
              >
                Browse all linked alcohol brand logos →
              </Link>
            </div>
          </div>

          <div
            className="brand-slider"
            role="region"
            aria-label="Explore brands"
            aria-roledescription="carousel"
            onMouseEnter={() => setCarouselPaused(true)}
            onMouseLeave={(e) => {
              if (!e.currentTarget.contains(document.activeElement)) setCarouselPaused(false);
            }}
            onFocusCapture={() => setCarouselPaused(true)}
          >
            {popularBrands.map((brand, i) => (
              <article
                className={"brand-slide" + (i === brandIndex ? " active" : "")}
                key={brand.name}
                aria-hidden={i !== brandIndex}
              >
                <div className="brand-meta">
                  <span>{brand.category}</span>
                  <span>
                    {String(i + 1).padStart(2, "0")} /{" "}
                    {String(popularBrands.length).padStart(2, "0")}
                  </span>
                </div>
                <div className="brand-logo-wrap">
                  <BrandLogo brand={brand.name} size={76} showFallbackBadge />
                  <h3 className="brand-wordmark">{brand.name}</h3>
                </div>
                <p>Ask us about current availability or view matching items in the Cooler Door.</p>
              </article>
            ))}
            <button
              type="button"
              className="slider-arrow prev"
              aria-label="Previous brand"
              onClick={() => {
                setCarouselPaused(true);
                setBrandIndex((index) => (index - 1 + popularBrands.length) % popularBrands.length);
              }}
            >
              ←
            </button>
            <button
              type="button"
              className="slider-arrow next"
              aria-label="Next brand"
              onClick={() => {
                setCarouselPaused(true);
                setBrandIndex((index) => (index + 1) % popularBrands.length);
              }}
            >
              →
            </button>
            <button
              type="button"
              className="carousel-control"
              aria-pressed={carouselPaused}
              onClick={() => setCarouselPaused((value) => !value)}
            >
              {carouselPaused ? "Resume brand rotation" : "Pause brand rotation"}
            </button>
          </div>
        </section>

        <div className="store-note">
          Honolulu, Hawaii · Live Cooler Door Excel Inventory · Brand Logos Directory · Keg
          Inquiries Welcome
        </div>

        <section id="kegs" className="section keg-section">
          <div className="keg-copy">
            <p className="eyebrow">Keg inquiries</p>
            <h2>
              Good company.
              <br />
              <span>We can help with the keg.</span>
            </h2>
            <p>
              Tell us which brand you have in mind and we will follow up to confirm availability,
              pricing, and pickup day.
            </p>
            <button type="button" className="button" onClick={(e) => openKegModal(e.currentTarget)}>
              Send a keg inquiry <span aria-hidden="true">→</span>
            </button>
          </div>
          <div className="rules">
            <div>
              <b>01</b>
              <strong>Paid in advance</strong>
              <p>The full keg cost must be paid in advance to secure your order.</p>
            </div>
            <div>
              <b>02</b>
              <strong>Need a pump?</strong>
              <p>
                A pump is not included with the keg. Ask about renting one for an additional charge.
              </p>
            </div>
            <div>
              <b>03</b>
              <strong>Return after use</strong>
              <p>Please return your rented pump after your gathering.</p>
            </div>
            <div>
              <b>04</b>
              <strong>Your pickup day</strong>
              <p>
                The brand schedule determines Wednesday or Friday morning pickup. We will confirm it
                with you.
              </p>
            </div>
          </div>
        </section>

        <section className="pickup">
          <div>
            <p className="eyebrow">Plan your pickup</p>
            <h2>
              A simple schedule.
              <br />
              <span>A little planning.</span>
            </h2>
            <p>
              Choose a brand in the inquiry form to see its scheduled pickup day. Pickup depends on
              availability and confirmation from our team.
            </p>
          </div>
          <div className="day-grid">
            <div>
              <span>WED</span>
              <strong>Wednesday</strong>
              <small>Morning pickup</small>
            </div>
            <div>
              <span>FRI</span>
              <strong>Friday</strong>
              <small>Morning pickup</small>
            </div>
          </div>
        </section>

        <section id="visit" className="visit">
          <p className="eyebrow">777 Liquor · Honolulu, Hawaiʻi</p>
          <h2>
            Come on by.
            <br />
            <span>Find something you like.</span>
          </h2>
          <p>
            Shopping for the weekend, bringing something to a gathering, or curious about a brand?
            We would love to help. Email us with questions or visit us in Honolulu.
          </p>
          <StoreInfo />
          <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
            <a className="button" href="mailto:777liquorstorehi@gmail.com">
              Get in touch <span aria-hidden="true">→</span>
            </a>
            <Link to="/cooler-door" className="button secondary">
              Browse Cooler Door
            </Link>
          </div>
        </section>
      </main>

      <KegModal open={showKeg} onClose={() => setShowKeg(false)} openerRef={openerRef} />
      <SiteFooter />
    </div>
  );
}
