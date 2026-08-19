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

export function LocalTime({
  value,
  display = "datetime",
  className,
}: {
  value: string;
  display?: TimeDisplay;
  className?: string;
}) {
  const [formatted, setFormatted] = useState(() => formatUserTimestamp(value, display, "en-IN", "Asia/Kolkata"));
  useEffect(() => setFormatted(formatUserTimestamp(value, display, browserLocale())), [value, display]);
  return (
    <time className={className} dateTime={value} suppressHydrationWarning>
      {formatted}
    </time>
  );
}
