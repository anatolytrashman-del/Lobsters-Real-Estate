// Саммери встреч — расшифровки/конспекты переговоров (с юристами,
// консультантами, контрагентами и т.п.), которые не хочется держать в
// файлах на компьютере. Публикуется по share_token на /summary/:token —
// без пароля админки, чтобы второй стороне разговора можно было просто
// скинуть ссылку почитать (тот же приём, что у Brief на /tz/:token).
// Предложение задачи, извлечённое LLM из расшифровки встречи (см.
// api/meeting-ai.js, action=suggest-tasks). Живёт в jsonb-поле саммери (как blocks у
// Moodboard) до решения владельца: «В задачи» — создаётся настоящая
// Task и статус становится approved, «Отклонить» — rejected. Уже
// решённые предложения не удаляются — остаются свёрнутым следом, чтобы
// повторная генерация не предлагала то же самое по второму разу.
export interface TaskSuggestion {
  id: string;
  title: string;
  description: string;
  assignees: string[];
  status: 'pending' | 'approved' | 'rejected';
}

export interface MeetingSummary {
  id: string;
  title: string;
  // Markdown — рендерится и в форме редактирования (превью), и на
  // публичной странице (см. lib/markdown.ts).
  content: string;
  // Сырая расшифровка аудиозаписи встречи (speech2text.ru, см.
  // api/transcribe.js + lib/meetingTranscribeApi.ts).
  // Хранится отдельно от content: content — причёсанное саммери для публичной
  // страницы, transcript — исходник, из которого саммери генерируется
  // (и к которому можно вернуться при смене промта). Само аудио НЕ
  // хранится — файл удаляется из Storage сразу после отправки на распознавание.
  transcript: string;
  taskSuggestions: TaskSuggestion[];
  shareToken: string;
  createdAt: string;
}

// Форма строки в таблице Supabase (snake_case-колонки) — см. src/lib/meetingSummariesApi.ts
export interface MeetingSummaryRow {
  id: string;
  title: string;
  content: string;
  transcript: string | null;
  task_suggestions: TaskSuggestion[] | null;
  share_token: string;
  created_at: string;
}
