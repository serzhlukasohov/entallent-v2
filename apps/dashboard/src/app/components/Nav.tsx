import Link from 'next/link';

const TABS = [
  { key: 'team', label: 'Команда', href: '/' },
  { key: 'cycles', label: 'Циклы', href: '/cycles' },
  { key: 'current', label: 'Текущий цикл', href: '/pulse' },
] as const;

export function Nav({ active }: { active: (typeof TABS)[number]['key'] }) {
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={t.key === active ? 'active' : undefined}
          aria-current={t.key === active ? 'page' : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
