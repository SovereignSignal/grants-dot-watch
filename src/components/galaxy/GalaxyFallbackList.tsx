// A11y alternative to the canvas: visually hidden until focused (standard
// skip-link pattern), so screen-reader and keyboard users get a direct route
// past the canvas instead of a dead end. With `visible`, renders as a real
// blocking panel instead — used when the 3D scene can't run at all (no
// WebGL, or the renderer failed to initialize).
export default function GalaxyFallbackList({ visible = false }: { visible?: boolean }) {
  if (visible) {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-void px-6">
        <div className="max-w-sm rounded-md border border-line bg-deep/80 p-8 text-center backdrop-blur">
          <p className="mb-4 text-sm text-dim">
            This browser can&apos;t render the 3D galaxy (no WebGL available). Browse the register as a list instead.
          </p>
          <a
            href="/orgs"
            className="inline-block rounded-md border border-line px-4 py-2 text-sm text-paper transition-colors hover:border-faint"
          >
            Browse as list → /orgs
          </a>
        </div>
      </div>
    );
  }

  return (
    <a
      href="/orgs"
      className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:border-line focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-paper"
    >
      Browse as list → /orgs
    </a>
  );
}
