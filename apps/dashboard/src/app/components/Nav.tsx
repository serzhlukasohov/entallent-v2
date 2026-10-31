import { CompanyLabel } from '../company-language';
import Link from 'next/link';

const TABS = [
  { key: 'team', label: "ui.016", href: '/' },
  { key: 'cycles', label: "ui.084", href: '/cycles' },
  { key: 'current', label: "ui.031", href: '/pulse' },
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
          <CompanyLabel label={t.label} />
        </Link>
      ))}
    </nav>
  );
}
