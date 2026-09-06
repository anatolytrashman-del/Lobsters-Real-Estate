import type { NearestMetroStation } from '../data/businessCenters';

// Разбор сырого ответа 2GIS (`nearest_stations` из карточки организации/
// здания) в наш чистый формат — владелец подключает 2GIS API в
// параллельной ветке (2026-09-06), формат прислал в чате:
//
//   "nearest_stations": [
//     { "id": "...", "name": "Петровщина", "distance": 550,
//       "comment": "Московская линия", "color": "#0064AF",
//       "route_types": ["metro"] },
//     ...
//   ]
//
// `nearest_metro` (id+distance) сознательно не читаем — вся нужная инфа
// уже в `nearest_stations`, дублировать нечего (сам владелец это отметил).
// `route_types` — общее поле 2GIS и для метро, и для наземного транспорта:
// фильтруем по нему явно, не полагаемся на то, что весь массив — только
// метро. Сортировка по возрастанию distance — самая близкая станция первой,
// не полагаемся на порядок в ответе источника.
export function parseNearestMetroStations(raw: unknown): NearestMetroStation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is Record<string, unknown> =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as Record<string, unknown>).name === 'string' &&
        typeof (s as Record<string, unknown>).distance === 'number' &&
        Array.isArray((s as Record<string, unknown>).route_types) &&
        ((s as Record<string, unknown>).route_types as unknown[]).includes('metro'),
    )
    .map((s) => ({
      name: s.name as string,
      distanceMeters: Math.round(s.distance as number),
      line: typeof s.comment === 'string' ? s.comment : null,
      color: typeof s.color === 'string' ? s.color : null,
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

// Ближайшая станция из уже сохранённого (отсортированного при парсинге, но
// не полагаемся на это — источник данных мог обновиться) массива.
export function nearestMetroStation(stations: NearestMetroStation[]): NearestMetroStation | null {
  if (stations.length === 0) return null;
  return [...stations].sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
}
