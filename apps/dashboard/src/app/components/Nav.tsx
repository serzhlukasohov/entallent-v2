import Link from 'next/link';

const TABS = [
  { key: 'trends', label: 'Trends', href: '/trends' },
  { key: 'pilot', label: 'V2 Pilot', href: '/pilot' },
] as const;

export function Nav({ active }: { active: 'trends' | 'pilot' }) {
  return (
    <nav style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            style={{
              fontSize: 13,
              fontWeight: 500,
              padding: '6px 14px',
              borderRadius: 8,
              color: isActive ? 'var(--text)' : 'var(--text-muted)',
              background: isActive ? 'var(--surface2)' : 'transparent',
              border: `1px solid ${isActive ? 'var(--border)' : 'transparent'}`,
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
