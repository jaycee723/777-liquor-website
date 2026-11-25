import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { FirebaseProvider } from "../components/FirebaseProvider";
import { reportHiggsfieldError } from "../lib/higgsfield-error-reporting";
import { SEO_DESCRIPTION, SEO_TITLE, STORE, localBusinessJsonLd } from "../lib/store-info";
import appMetaJson from "../app-meta.json";

const GA_ID = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined) || "";

type AppMeta = {
  og_title?: string | null;
  og_description?: string | null;
  og_image_url?: string | null;
  favicon_url?: string | null;
  og_video_url?: string | null;
};

const appMeta = appMetaJson as AppMeta;
const APP_HOST_ZONES = ["higgsfield.app", "higgsfield-dev.app"];

function toOwnAssetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/")) return value;
  try {
    const u = new URL(value);
    const isAppHost = APP_HOST_ZONES.some(
      (zone) => u.hostname === zone || u.hostname.endsWith(`.${zone}`),
    );
    if (isAppHost) return u.pathname + u.search;
    return value;
  } catch {
    return value;
  }
}

function buildHead(meta: AppMeta) {
  const title = SEO_TITLE;
  const description = SEO_DESCRIPTION;
  const ogImage = toOwnAssetUrl(meta.og_image_url);
  const favicon = toOwnAssetUrl(meta.favicon_url);
  const ogVideo = toOwnAssetUrl(meta.og_video_url);

  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title },
      { name: "description", content: description },
      { name: "theme-color", content: "#070D14" },
      { name: "author", content: STORE.shortName },
      { name: "robots", content: "index,follow,max-image-preview:large" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: STORE.url },
      { property: "og:site_name", content: STORE.name },
      { property: "og:locale", content: "en_US" },
      { name: "twitter:card", content: ogImage ? "summary_large_image" : "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      ...(ogImage
        ? [
            { property: "og:image", content: ogImage },
            { name: "twitter:image", content: ogImage },
          ]
        : []),
      ...(ogVideo ? [{ property: "og:video", content: ogVideo }] : []),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      ...(favicon ? [{ rel: "icon", href: favicon, type: "image/png" }] : []),
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
    scripts: [
      { type: "application/ld+json", children: JSON.stringify(localBusinessJsonLd(ogImage)) },
      ...(GA_ID
        ? [
            { src: `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`, async: true },
            {
              children: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`,
            },
          ]
        : []),
    ],
  };
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#070D14] px-6 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#111B2B] p-8 text-center">
        <p className="font-mono text-sm font-semibold tracking-widest text-cyan-400">404</p>
        <h1 className="mt-2 font-display text-2xl font-bold text-slate-100">Page not found</h1>
        <p className="mt-2 text-sm text-slate-400">
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300"
          >
            Go home
          </Link>
          <Link
            to="/cooler-door"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 bg-[#0B1220] px-5 text-sm font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300"
          >
            Cooler Door
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportHiggsfieldError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#070D14] px-6 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#111B2B] p-8 text-center">
        <h1 className="font-display text-2xl font-bold text-slate-100">This page didn't load</h1>
        <p className="mt-2 text-sm text-slate-400">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 bg-[#0B1220] px-5 text-sm font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => buildHead(appMeta),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className="dark"
      data-theme="default-dark"
      style={{ colorScheme: "dark" }}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-[#070D14] text-slate-100 antialiased" suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <FirebaseProvider>
        <Outlet />
      </FirebaseProvider>
    </QueryClientProvider>
  );
}
