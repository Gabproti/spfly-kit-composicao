export const businessTimeZone = "America/Sao_Paulo";
export function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: businessTimeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: businessTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function dayBounds(day: string) {
  const start = new Date(`${day}T00:00:00-03:00`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
