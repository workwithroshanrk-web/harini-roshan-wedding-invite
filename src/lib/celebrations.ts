export const celebrations = [
  {
    id: "901e55c9-2a1c-4aa2-b7bc-27f5e375be01",
    name: "Poo Vaikum Function",
    event_date: "2027-01-20",
    tamil_date: "Thai 6",
    time_label: "Evening · 6:00–8:30 PM",
    starts: "2027-01-20T18:00:00+05:30",
    ends: "2027-01-20T20:30:00+05:30",
    location: "",
    description: "",
  },
  {
    id: "901e55c9-2a1c-4aa2-b7bc-27f5e375be02",
    name: "Engagement",
    event_date: "2027-04-17",
    tamil_date: "Chithirai 4",
    time_label: "Evening · 6:00 PM",
    starts: "2027-04-17T18:00:00+05:30",
    ends: null,
    location: "Divyaguru Mahal, Peraiyur",
    description: "",
  },
  {
    id: "901e55c9-2a1c-4aa2-b7bc-27f5e375be03",
    name: "Marriage",
    event_date: "2027-04-18",
    tamil_date: "Chithirai 5",
    time_label: "Morning · 9:00 AM",
    starts: "2027-04-18T09:00:00+05:30",
    ends: null,
    location: "Divyaguru Mahal, Peraiyur",
    description: "",
  },
];

export const weddingFunctions = celebrations;
export function celebrationDetails(rows: Celebration[]): Celebration[] {
  return celebrations.map((event) => {
    const saved = rows.find(
      (row) =>
        row.id === event.id ||
        row.name.trim().toLowerCase() === event.name.toLowerCase(),
    );
    return saved ? { ...event, ...saved } : event;
  });
}

export type Celebration = {
  id: string;
  name: string;
  event_date?: string | null;
  tamil_date?: string;
  time_label?: string;
  starts?: string | null;
  ends?: string | null;
  location?: string;
  description?: string;
};

export function countdown(event: Celebration, now: number): string {
  if (event.starts) {
    const start = Date.parse(event.starts);
    if (!Number.isFinite(start)) return "Date to be announced";
    const seconds = Math.max(0, Math.floor((start - now) / 1000));
    if (now >= start)
      return event.ends && now >= Date.parse(event.ends)
        ? "This function’s scheduled time has passed"
        : "The celebration has begun";
    return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
  }
  if (!event.event_date) return "Date to be announced";
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  const days = Math.round(
    (Date.parse(event.event_date.slice(0, 10)) - Date.parse(day)) / 86400000,
  );
  if (!Number.isFinite(days)) return "Date to be announced";
  return days > 0
    ? `${days} ${days === 1 ? "day" : "days"} to go`
    : days === 0
      ? "Today is the day"
      : "A day to remember";
}
