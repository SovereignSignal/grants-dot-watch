// A11y alternative to the canvas: visually hidden until focused (standard
// skip-link pattern), so screen-reader and keyboard users get a direct route
// past the canvas instead of a dead end.
export default function GalaxyFallbackList() {
  return (
    <a
      href="/orgs"
      className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:border-line focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-paper"
    >
      Browse as list → /orgs
    </a>
  );
}
