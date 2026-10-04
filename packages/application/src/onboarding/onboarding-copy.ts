import type { PrimaryOrgRole } from '../hierarchy/draft-person';

const PERSONAL_TRUST = `Your conversations and individual responses are not shown to anyone. If insights come up that could help improve the work environment, I'll ask for your permission to use them in a fully anonymized form — for a team report and recommendations to your manager on how to improve team management.

You decide which insights you're comfortable sharing. Without your approval, they won't be included in reports or recommendations.`;
const VOLUNTARY = `Participation is voluntary: you can skip a question, postpone a conversation, or opt out. You can come back anytime — just message me as you would a familiar colleague.`;
const REPORT_TRUST = `Reports use only data that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.

You receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.`;
const INTRO: Record<PrimaryOrgRole, string> = {
  employee: `Hi! I'm Emma 👋 Your virtual colleague — someone who's here to listen, help you work through a situation, or give you space to vent.

You can message me anytime: about a difficult day, relationships with colleagues, something that makes you happy or worries you, or anything else you'd like to talk about. I'll listen and help you think things through if that's what you need.

Sometimes I'll also invite you to a short conversation about how things are going at work. These conversations help us understand what makes your work environment more comfortable and where support is needed.`,
  team_lead: `Hi! I'm Emma 👋 Your virtual colleague and AI co-pilot for team management.

You can talk to me about your own experience at work, work through a situation, or simply vent. Message me anytime — about work or anything else that's on your mind.

As a Team Lead, you'll also receive shared signals about your team and recommendations. I'll help you choose your next step, prepare for a conversation, and reflect on what worked afterward. Managing a team becomes something you learn through practice.`,
  manager: `Hi! I'm Emma 👋 Your AI co-pilot for team management.

I'll help you notice where your team needs support, understand possible reasons, and choose practical actions. You can discuss a management situation with me, prepare your next step, and reflect on what worked afterward.

Managing a team becomes something you learn by doing — one decision at a time.`,
  hr: `Hi! I'm Emma 👋 I'll help you spot emerging challenges across the organization and identify where support is needed sooner.

Numbers alone don't always explain what people are experiencing. Shared signals from conversations help you understand what concerns employees, what they're missing, and what's already working well.

I'll help you make sense of this information and suggest practical steps to improve the work environment.`,
  hrbp: `Hi! I'm Emma 👋 I'll help you spot emerging challenges in the teams you support and help their leaders choose what to do next.

Shared signals from conversations add context to the numbers: they help you understand what concerns people, where support is missing, and what's already working well.

You can work through these signals with me and quickly prepare recommendations for team leaders.`,
  leadership: `Hi! I'm Emma 👋 I'll help you see the overall picture of the work environment within your area of responsibility: what helps teams work well, where challenges are emerging, and what needs attention.

Shared signals from conversations add context to the numbers and help you understand why things are happening. I'll help you identify priorities and suggest actions to improve management and support your teams.`,
};
export function onboardingCopy(role: PrimaryOrgRole, language = 'en'): string {
  if (language === 'ru' || language === 'uk') return localizedCopy(role, language);
  const trust = role === 'employee' ? `${PERSONAL_TRUST}

${VOLUNTARY}

Shall we talk about how things are going at work? You can also start by telling me what's on your mind.`
    : role === 'team_lead' ? `${PERSONAL_TRUST}

${REPORT_TRUST}

Your personal participation is voluntary and does not affect your access to team reports. You can skip a question, postpone a conversation, or opt out, and return anytime.

Would you like to start a personal conversation, or finish the introduction for now?`
      : `${REPORT_TRUST}

Ready to get started?`;
  return `${INTRO[role]}

${trust}`;
}

function localizedCopy(role: PrimaryOrgRole, language: 'ru' | 'uk'): string {
  const ru = language === 'ru';
  const personal = role === 'employee' || role === 'team_lead';
  const intro = role === 'employee'
    ? ru ? 'Привет! Я Эмма 👋 Твой виртуальный коллега — внимательный собеседник, с которым можно разобраться в ситуации или просто выговориться.'
      : 'Привіт! Я Емма 👋 Твій віртуальний колега — уважний співрозмовник, з яким можна розібратися в ситуації або просто виговоритися.'
    : role === 'team_lead' || role === 'manager'
      ? ru ? 'Привет! Я Эмма 👋 Твой AI-напарник в управлении командой. Помогу понять общие сигналы команды, выбрать следующий шаг и разобрать, что сработало. Управлять становится понятнее через практику.'
        : 'Привіт! Я Емма 👋 Твій ШІ-напарник в управлінні командою. Допоможу зрозуміти спільні сигнали команди, обрати наступний крок і розібрати, що спрацювало. Управління стає зрозумілішим через практику.'
      : ru ? 'Привет! Я Эмма 👋 Помогу раньше замечать трудности в твоей области ответственности. Общие сигналы из разговоров дополняют цифры: что беспокоит людей, где нужна поддержка и что работает хорошо. Вместе разберёмся в сигналах и выберем конкретные действия.'
        : 'Привіт! Я Емма 👋 Допоможу раніше помічати труднощі у твоїй сфері відповідальності. Спільні сигнали з розмов доповнюють цифри: що турбує людей, де потрібна підтримка і що працює добре. Разом розберемося в сигналах і оберемо конкретні дії.';
  const chat = ru ? 'Можешь написать мне в любой момент — о сложном дне, отношениях с коллегами или о чём-то другом, что хочется обсудить. Я выслушаю и помогу подумать, если тебе это нужно. Иногда я сама приглашу тебя к короткому разговору о том, как тебе работается.'
    : 'Можеш написати мені будь-коли — про складний день, стосунки з колегами або про щось інше, що хочеться обговорити. Я вислухаю і допоможу подумати, якщо тобі це потрібно. Іноді я сама запрошу тебе до короткої розмови про те, як тобі працюється.';
  const trust = personal
    ? ru ? 'Твоя переписка и персональные ответы никому не показываются. Если появятся инсайты, которые могут помочь улучшить рабочую среду, я спрошу твоего разрешения использовать их в полностью анонимизированном виде — для командного отчёта и рекомендаций менеджеру. Без твоего подтверждения они не попадут в отчёты и рекомендации. Участие добровольное: можно пропустить вопрос, отложить разговор или отказаться. Вернуться можно в любой момент — просто написать мне.'
      : 'Твоя переписка й особисті відповіді нікому не показуються. Якщо з’являться інсайти, які можуть допомогти поліпшити робоче середовище, я запитаю твого дозволу використати їх у повністю анонімізованому вигляді — для командного звіту й рекомендацій менеджеру. Без твого підтвердження вони не потраплять у звіти й рекомендації. Участь добровільна: можна пропустити запитання, відкласти розмову або відмовитися. Повернутися можна будь-коли — просто написати мені.'
    : ru ? 'В отчётах используются только данные, которые сотрудники разрешили использовать, и только в полностью анонимизированном виде. Переписка и персональные ответы сотрудников никому не показываются. Ты получаешь общие сигналы и рекомендации в своей области ответственности без раскрытия авторов.'
      : 'У звітах використовуються лише дані, які співробітники дозволили використовувати, і лише в повністю анонімізованому вигляді. Переписка й особисті відповіді співробітників нікому не показуються. Ти отримуєш спільні сигнали й рекомендації у своїй сфері відповідальності без розкриття авторів.';
  const dual = role === 'team_lead' ? ru ? 'В командных отчётах действуют те же правила. Твоё личное участие добровольное и не влияет на доступ к отчётам.'
    : 'У командних звітах діють ті самі правила. Твоя особиста участь добровільна і не впливає на доступ до звітів.' : '';
  return [intro, personal ? chat : '', trust, dual, personal ? ru ? 'Хочешь поговорить о том, как тебе сейчас работается?' : 'Хочеш поговорити про те, як тобі зараз працюється?'
    : ru ? 'Начнём?' : 'Почнемо?'].filter(Boolean).join('\n\n');
}
