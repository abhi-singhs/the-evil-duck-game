import type { WeaponId } from '../game/types'

export function WeaponIcon({ weapon, className = '' }: { weapon: WeaponId; className?: string }) {
  const paths: Record<WeaponId, string> = {
    pistol: 'M5 11h25v3h4v5H18v4h-3v8H9V20H5z M22 7h5v4h-5z',
    shotgun: 'M3 12h34v5H16v4H9v5H3z M15 18h13v4H15z M8 8h3v4H8z',
    blaster: 'M3 11h9V8h4v3h17v3h5v5H24v4h-4v9h-6V20H8v5H3z M25 7h5v4h-5z',
    rocket: 'M2 11h29V7h4v4h3v10h-3v4h-4v-4H18v4h-4v6H8V21H2z M23 7h4v4h-4z',
  }
  return <svg className={className} viewBox="0 0 40 36" fill="currentColor" aria-hidden="true"><path d={paths[weapon]} /></svg>
}

export function DuckIcon() {
  return <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
    <path d="M15 4h10v4h3v6h4v4h-9v7h-4v3H6v-3H3V15h4v4h8z" />
    <path className="duck-eye" d="M21 9h3v3h-3z" />
  </svg>
}

export function SoundIcon({ muted }: { muted: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    {muted ? <path d="m16 9 6 6m0-6-6 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>}
  </svg>
}
