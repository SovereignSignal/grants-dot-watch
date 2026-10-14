// The house-style endorsement line: the small Sovereign Signal compass and
// "A Sovereign Signal project". Geometry is the brand repo's compass-small.svg
// (sovereign-signal-brand/marks), inlined so it follows the page tokens.
export function SovereignSignalEndorsement() {
  return (
    <span className="endorsement">
      <svg viewBox="0 0 64 64" aria-hidden focusable="false">
        <g fill="none" stroke="currentColor" strokeWidth="2.2">
          <circle cx="32" cy="32" r="18.5" />
          <circle cx="32" cy="32" r="29" />
        </g>
        <path fill="currentColor" d="M32 32 26.97 26.97 31.51 0.91 32.49 0.91 37.03 26.97Z M32 32 37.03 26.97 63.09 31.51 63.09 32.49 37.03 37.03Z M32 32 37.03 37.03 32.49 63.09 31.51 63.09 26.97 37.03Z M32 32 26.97 37.03 0.91 32.49 0.91 31.51 26.97 26.97Z" />
        <path style={{ fill: 'var(--paper)' }} d="M32.5 6.78 36 26.87 32.5 30.37Z M57.22 32.5 37.13 36 33.63 32.5Z M31.5 57.22 28 37.13 31.5 33.63Z M6.78 31.5 26.87 28 30.37 31.5Z" />
        <path style={{ fill: 'var(--paper)' }} d="M32 25.5 L38.5 32 L32 38.5 L25.5 32Z" />
        <path style={{ fill: 'var(--rust)' }} d="M32 27.3 L36.7 32 L32 36.7 L27.3 32Z" />
      </svg>
      A Sovereign Signal project
    </span>
  );
}
