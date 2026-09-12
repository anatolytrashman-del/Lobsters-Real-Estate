import { extractTelegramHandle } from '../../lib/telegramHandle';

// Контакт хранит и телефон, и телеграм-юзернейм, и голую ссылку на переписку
// (например, диалог на Kufar) — способ связи (contactMethod) подсказывает,
// как из этого сделать кликабельную ссылку, ведущую сразу в диалог:
// Telegram-юзернейм превращается в t.me-ссылку, любой готовый http(s)-адрес
// (Kufar и т.п.) используется как есть. Номера телефонов ссылкой не
// становятся — с ними это ничего не открывает.
//
// Общий компонент для лидов и подрядчиков (contact/contactMethod — один и тот
// же паттерн в обеих сущностях), раньше жил только в components/leads.
export function buildDialogLink(contactMethod: string, contact: string): string | null {
  if (!contact.trim()) return null;
  if (contactMethod === 'Telegram') {
    const handle = extractTelegramHandle(contact);
    return handle ? `https://t.me/${handle}` : null;
  }
  return /^https?:\/\//i.test(contact.trim()) ? contact.trim() : null;
}

// interactive=false — просто текст, без ссылки на диалог (нужно там, где
// контакт должен быть виден, но не кликабелен, например у подрядчиков).
export function ContactValue({
  contact,
  contactMethod,
  interactive = true,
}: {
  contact: string;
  contactMethod?: string;
  interactive?: boolean;
}) {
  if (!contact) return null;
  const href = interactive ? buildDialogLink(contactMethod ?? '', contact) : null;
  if (href) {
    return (
      // text-primary-hover, не text-primary — тот же фикс, что уже применён
      // для логотипа в AppLayout.tsx/DistrictGuidePage.tsx: базовый красный
      // на этом фоне даёт контраст на грани/ниже 4,5:1 (UX-аудит, найдено на
      // карточке лида в /admin/leads).
      <a href={href} target="_blank" rel="noreferrer" className="truncate text-primary-hover hover:underline">
        {contact}
      </a>
    );
  }
  return <>{contact}</>;
}
