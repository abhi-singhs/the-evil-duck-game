import type { PlayerState } from '../game/types'

const number = (value: number) => Math.round(value).toLocaleString('en-US')

type Props = {
  players: Record<string, PlayerState>
  localId: string
  teamDamage: number
}

/** A live scoreboard during a co-op run: who is contributing, and who is still standing. */
export function TeamPanel({ players, localId, teamDamage }: Props) {
  const roster = Object.values(players)
    .sort((a, b) => b.damage - a.damage || a.name.localeCompare(b.name))
    .slice(0, 12)
  const alive = Object.values(players).filter((player) => player.hp > 0 && player.connected).length

  return (
    <aside className="team-panel" aria-label="Team">
      <header>
        <span>TEAM</span>
        <span className="team-total">{number(teamDamage)} dmg</span>
      </header>
      <p className="team-alive">{alive} of {Object.keys(players).length} standing</p>
      <ol>
        {roster.map((player) => (
          <li key={player.id} className={player.id === localId ? 'me' : player.hp === 0 ? 'down' : ''}>
            <span className="team-name">{player.id === localId ? 'You' : player.name}</span>
            <span className="team-hp" aria-label={`${player.hp} health`}>{'|'.repeat(player.hp) || '—'}</span>
            <span className="team-damage">{number(player.damage)}</span>
          </li>
        ))}
      </ol>
      {Object.keys(players).length > roster.length
        && <p className="team-more">+{Object.keys(players).length - roster.length} more</p>}
    </aside>
  )
}
