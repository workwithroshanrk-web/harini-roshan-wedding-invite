export const celebrations = [
  {
    id: "901e55c9-2a1c-4aa2-b7bc-27f5e375be01",
    name: "Poo Vaikum Function",
    event_date: "2027-01-20",
    tamil_date: "Thai 6",
    time_label: "Evening · 6:00–8:30 PM",
    starts: "2027-01-20T18:00:00+05:30",
    ends: "2027-01-20T20:30:00+05:30",
    location: "Reddiyar Marriage Mahal",
    map_url: "https://www.google.com/maps/place/Reddiyar+Marriage+Mahal/@9.3710229,77.9112417,17z/data=!3m1!4b1!4m6!3m5!1s0x3b06cadad8c20821:0xd914149569201629!8m2!3d9.3710229!4d77.9138166!16s%2Fg%2F11bxftr699",
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
    map_url: "https://www.google.com/maps/place/DIVYAGURU+MAHAL/@9.7448586,77.7870352,17z/data=!3m1!4b1!4m6!3m5!1s0x3b072900018749d7:0xdf9f1ee8ba82a154!8m2!3d9.7448586!4d77.7896101!16s%2Fg%2F11x5v2mnyx",
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
    map_url: "https://www.google.com/maps/place/DIVYAGURU+MAHAL/@9.7448586,77.7870352,17z/data=!3m1!4b1!4m6!3m5!1s0x3b072900018749d7:0xdf9f1ee8ba82a154!8m2!3d9.7448586!4d77.7896101!16s%2Fg%2F11x5v2mnyx",
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
  map_url?: string;
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
