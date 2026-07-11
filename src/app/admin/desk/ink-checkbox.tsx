'use client';

/** The Desk's selection mark: a small square that fills solid ink when
 *  checked — no native checkbox chrome, no color, matching the canon mock's
 *  "selection checkbox as a small square that fills ink when checked."
 *  Supports the "select all in group" indeterminate state via the same
 *  imperative `.indeterminate` DOM property the native checkbox uses. */
export function InkCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      onChange={onChange}
      aria-label={label}
      className="size-3.5 shrink-0 cursor-pointer appearance-none border border-line bg-transparent align-middle checked:border-paper checked:bg-paper [&:indeterminate]:border-paper [&:indeterminate]:bg-dim"
    />
  );
}
