export function formatCountdown(seconds: number): string {
  const wholeSeconds = Math.ceil(Math.max(0, seconds))
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`
}
