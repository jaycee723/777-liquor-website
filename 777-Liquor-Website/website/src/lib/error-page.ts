export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en" class="dark" style="color-scheme: dark;">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load — 777 Liquor</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.6 system-ui, -apple-system, sans-serif; background: #070d14; color: #f1f5f9; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; border-radius: 1rem; background: #111b2b; border: 1px solid #1f2f46; }
      h1 { font-size: 1.35rem; margin: 0 0 0.6rem; color: #f1f5f9; }
      p { color: #94a3b8; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.65rem 1.2rem; border-radius: 0.75rem; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #22d3ee; color: #06131d; }
      .secondary { background: #0b1220; color: #f1f5f9; border-color: #2d4361; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try refreshing or head back home.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
  </body>
</html>`;
}
