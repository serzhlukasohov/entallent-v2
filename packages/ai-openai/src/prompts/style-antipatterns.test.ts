import { describe, it, expect } from 'vitest';
import { hasReflectiveOpener } from './style-antipatterns';

describe('hasReflectiveOpener', () => {
  it('flags observed verdict-on-their-words openers', () => {
    expect(hasReflectiveOpener('Вот это уже звучит как очень трезвая позиция: тебе важен результат.')).toBe(true);
    expect(hasReflectiveOpener('Вот это, похоже, и есть корень: не просто шум, а шум который заражает.')).toBe(true);
    expect(hasReflectiveOpener('Звучит как классическая перегрузка.')).toBe(true);
    expect(hasReflectiveOpener('То, что ты описываешь — это выгорание.')).toBe(true);
  });

  it('does not flag replies that lead with substance or a question', () => {
    expect(hasReflectiveOpener('А когда лид сказал «да-да» — это было безразличие или у него не было ответа?')).toBe(false);
    expect(hasReflectiveOpener('Роль у тебя вроде ясная, но решения всё равно идут через Рому — это тормозит?')).toBe(false);
    expect(hasReflectiveOpener('Окей. Что из этого злит сильнее всего?')).toBe(false);
  });

  it('only inspects the opener, not later sentences', () => {
    // A between-the-lines naming later in the reply is fine.
    expect(hasReflectiveOpener('Давай по порядку. Похоже, дело не в дедлайнах.')).toBe(false);
  });
});
