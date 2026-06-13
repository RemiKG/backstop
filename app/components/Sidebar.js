'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Wordmark from './Wordmark';

const NAV = [
  { href: '/', label: 'Estate', icon: 'grid' },
  { href: '/run', label: 'Run', icon: 'play' },
  { href: '/blind', label: 'Blind Wall', icon: 'eye' },
  { href: '/handback', label: 'Hand-back', icon: 'save' },
  { href: '/settings', label: 'Settings', icon: 'cog' },
];

function Icon({ name }) {
  const p = {
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    play: 'M8 5v14l11-7z',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6z',
    save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 14h8v5H8z',
    cog: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  }[name];
  return (
    <svg className="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={p} />
    </svg>
  );
}

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sidebar">
      <Wordmark />
      <nav className="nav">
        {NAV.map((n) => {
          const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={active ? 'active' : ''}>
              <Icon name={n.icon} />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="side-foot">
        <div className="role">Detection Engineer</div>
        <div style={{ marginTop: 8 }}>
          Proof-by-silence. A detection&apos;s health is arithmetic on a real
          <span className="mono"> latest(_time)</span> — re-run it yourself.
        </div>
      </div>
    </aside>
  );
}
