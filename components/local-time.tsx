"use client";
import { useEffect, useState } from "react";

export type TimeDisplay = "date" | "time" | "datetime";

function browserLocale() {
  const locale = navigator.languages?.[0] || navigator.language || "en-IN";
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (zone === "Asia/Kolkata" || zone === "Asia/Calcutta") && locale.toLowerCase() === "en-us" ? "en-IN" : locale;
}

export function formatUserTimestamp(value: string, display: TimeDisplay, locale = "en-IN", timeZone?: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const dateParts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
  const timeParts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat(locale, {
    ...(display !== "time" ? dateParts : {}),
    ...(display !== "date" ? timeParts : {}),
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function formatCompactTimestamp(value: string, locale = "en-IN", timeZone?: string, now = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  if (day.format(date) === day.format(now))
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(date);
  const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone });
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(year.format(date) !== year.format(now) ? { year: "numeric" } : {}),
    timeZone,
  }).format(date);
}

export function LocalTime({
  value,
  display = "datetime",
  className,
  responsive = false,
}: {
  value: string;
  display?: TimeDisplay;
  className?: string;
  responsive?: boolean;
}) {
  const [formatted, setFormatted] = useState(() => ({
    full: formatUserTimestamp(value, display, "en-IN", "Asia/Kolkata"),
    compact: responsive ? formatCompactTimestamp(value, "en-IN", "Asia/Kolkata") : "",
  }));
  useEffect(
    () =>
      setFormatted({
        full: formatUserTimestamp(value, display, browserLocale()),
        compact: responsive ? formatCompactTimestamp(value, browserLocale()) : "",
      }),
    [value, display, responsive],
  );
  return (
    <time className={className} dateTime={value} title={formatted.full} suppressHydrationWarning>
      <span className={responsive ? "timestamp-full" : undefined} suppressHydrationWarning>
        {formatted.full}
      </span>
      {responsive && (
        <span className="timestamp-compact" aria-hidden="true" suppressHydrationWarning>
          {formatted.compact}
        </span>
      )}
    </time>
  );
}
