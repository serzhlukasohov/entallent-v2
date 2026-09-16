export const REPORTING_DISCLOSURE_VERSION = 'reporting-disclosure-v1';

const REPORTING_DISCLOSURE_TEXT = {
  en: 'If you confirm a de-identified pulse summary, it may contribute only to aggregated team-level recommendations. You can correct it or ask me to exclude it from reporting.',
  ru: 'Если ты подтвердишь обезличенное резюме пульс-опроса, оно может использоваться только в агрегированных рекомендациях для команды. Ты можешь исправить его или попросить меня исключить его из отчётности.',
  uk: 'Якщо ти підтвердиш знеособлене резюме пульс-опитування, воно може використовуватися лише в агрегованих рекомендаціях для команди. Ти можеш виправити його або попросити мене виключити його зі звітності.',
} as const;

const REPORTING_ACCESS_EXPLANATION_TEXT = {
  en: 'Confirmation approves only the exact de-identified summary shown and does not change access permissions. It does not let managers or HR read your individual messages, answers, personal summary, tasks, goals, or identity through EnTalent reporting. Separate audited internal operational access is not granted by confirmation. Conversation data or temporary working state may still be retained under product retention rules, but storage alone never makes it reportable. Unconfirmed pulse answers and temporary summaries never contribute to team-report scoring, aggregation, themes, recommendations, intermediate reports, or final reports. Only the exact shown summary may contribute to team-level reporting after it is confirmed, de-identified, and non-withdrawn.',
  ru: 'Подтверждение одобряет только показанный точный текст обезличенного резюме и не меняет права доступа. Оно не позволяет менеджерам или HR читать через отчётность EnTalent твои личные сообщения, ответы, персональное резюме, задачи, цели или данные, раскрывающие личность. Отдельный аудируемый внутренний операционный доступ не предоставляется подтверждением. Данные разговора или временное рабочее состояние могут по-прежнему храниться согласно правилам хранения продукта, но само хранение никогда не делает их доступными для отчётности. Неподтверждённые ответы пульс-опроса и временные резюме никогда не участвуют в оценке, агрегации, темах, рекомендациях, промежуточных или итоговых отчётах. В командную отчётность может попасть только показанное точное резюме после подтверждения и обезличивания, если оно не отозвано.',
  uk: 'Підтвердження схвалює лише показаний точний текст знеособленого резюме й не змінює права доступу. Воно не дозволяє менеджерам або HR читати через звітність EnTalent твої особисті повідомлення, відповіді, персональне резюме, завдання, цілі чи дані, що розкривають особу. Окремий аудитований внутрішній операційний доступ не надається підтвердженням. Дані розмови або тимчасовий робочий стан можуть і далі зберігатися за правилами зберігання продукту, але саме зберігання ніколи не робить їх придатними для звітності. Непідтверджені відповіді пульс-опитування й тимчасові резюме ніколи не беруть участі в оцінюванні, агрегації, темах, рекомендаціях, проміжних або підсумкових звітах. До командної звітності може потрапити лише показане точне резюме після підтвердження й знеособлення, якщо його не відкликано.',
} as const;

const DATA_USE_EXPLANATION_TEXT = {
  en: 'I am an AI assistant, not a human. I use your messages to respond in this conversation. They may also support optional private memory and relevant goals, tasks, or reminders; pulse measurement; and safety checks. Private memory and unconfirmed material are not reportable. Only the exact shown summary may contribute to team-level reporting after it is confirmed, de-identified, and non-withdrawn. Messages and derived product data are kept under product retention rules. Audited internal admin and debugging access is limited to authorized staff.',
  ru: 'Я — ИИ-помощник, а не человек. Я использую твои сообщения, чтобы отвечать в этом разговоре. Они также могут использоваться для необязательной личной памяти и релевантных целей, задач или напоминаний, измерения пульса команды и проверок безопасности. Личная память и неподтверждённые материалы не подлежат отчётности. В командную отчётность может попасть только показанное точное резюме после подтверждения и обезличивания, если оно не отозвано. Сообщения и производные данные продукта хранятся согласно правилам хранения продукта. Внутренний административный доступ и доступ для отладки разрешён только уполномоченным сотрудникам и аудируется.',
  uk: 'Я — ШІ-помічник, а не людина. Я використовую твої повідомлення, щоб відповідати в цій розмові. Вони також можуть використовуватися для необов’язкової приватної пам’яті та релевантних цілей, завдань або нагадувань, вимірювання пульсу команди й перевірок безпеки. Приватна пам’ять і непідтверджені матеріали не підлягають звітності. До командної звітності може потрапити лише показане точне резюме після підтвердження й знеособлення, якщо його не відкликано. Повідомлення та похідні дані продукту зберігаються за правилами зберігання продукту. Внутрішній адміністративний доступ і доступ для налагодження дозволений лише уповноваженим працівникам та аудитується.',
} as const;

export function getReportingDisclosureText(language?: string): string {
  const baseLanguage = language?.toLowerCase().split('-')[0] as keyof typeof REPORTING_DISCLOSURE_TEXT;
  return REPORTING_DISCLOSURE_TEXT[baseLanguage] ?? REPORTING_DISCLOSURE_TEXT.en;
}

export function getReportingExplanationText(language?: string): string {
  const baseLanguage = language?.toLowerCase().split('-')[0] as keyof typeof REPORTING_ACCESS_EXPLANATION_TEXT;
  const explanation = REPORTING_ACCESS_EXPLANATION_TEXT[baseLanguage]
    ?? REPORTING_ACCESS_EXPLANATION_TEXT.en;
  return `${explanation}\n\n${getReportingDisclosureText(language)}`;
}

export function getDataUseExplanationText(language?: string): string {
  const baseLanguage = language?.toLowerCase().split('-')[0] as keyof typeof DATA_USE_EXPLANATION_TEXT;
  return DATA_USE_EXPLANATION_TEXT[baseLanguage] ?? DATA_USE_EXPLANATION_TEXT.en;
}

export function appendReportingDisclosure(responseText: string, language?: string): string {
  const disclosure = getReportingDisclosureText(language);
  if (responseText.includes(disclosure)) return responseText;
  return responseText ? `${responseText}\n\n${disclosure}` : disclosure;
}
