import { describe, it, expect } from 'vitest';
import { hasReflectiveOpener } from './style-antipatterns';

describe('hasReflectiveOpener', () => {
  it('flags observed verdict-on-their-words openers', () => {
    expect(hasReflectiveOpener("That's already sounding like a very clear-eyed take: results matter to you.")).toBe(true);
    expect(hasReflectiveOpener('That, it seems, is the real root: not just noise, but noise that spreads.')).toBe(true);
    expect(hasReflectiveOpener('Sounds like a classic overload.')).toBe(true);
    expect(hasReflectiveOpener("What you're describing is burnout.")).toBe(true);
  });

  it('does not flag replies that lead with substance or a question', () => {
    expect(hasReflectiveOpener("And when your lead said 'yeah, yeah' — was that indifference, or did he just not have an answer?")).toBe(false);
    expect(hasReflectiveOpener('Your role seems clear enough, but decisions still route through Roma — is that what slows things down?')).toBe(false);
    expect(hasReflectiveOpener('Okay. Which part of this makes you angriest?')).toBe(false);
  });

  it('only inspects the opener, not later sentences', () => {
    // A between-the-lines naming later in the reply is fine.
    expect(hasReflectiveOpener("Let's take it in order. Sounds like it's not really about the deadlines.")).toBe(false);
  });
});
