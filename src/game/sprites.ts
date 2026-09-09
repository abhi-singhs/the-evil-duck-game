export type Palette = {
  bg: string
  elevated: string
  surface: string
  border: string
  text: string
  muted: string
  accent: string
  warning: string
  danger: string
  success: string
  link: string
  night: boolean
  skyTop: string
  skyBottom: string
  sun: string
  cloud: string
  hill: string
  hillFar: string
  reed: string
  reedHead: string
  waterTop: string
  waterBottom: string
  foam: string
  lily: string
  bank: string
  star: string
  duck: string
  duckShade: string
  duckLine: string
  beak: string
  eye: string
  armor: string
  crest: string
  egg: string
  eggWarn: string
}

export function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement)
  const color = (name: string) => style.getPropertyValue(`--cp-${name}`).trim()
  const game = (name: string) => style.getPropertyValue(`--game-${name}`).trim()
  return {
    bg: color('bg'), elevated: color('bg-elevated'), surface: color('surface'),
    border: color('border'), text: color('text'), muted: color('text-muted'),
    accent: color('accent'), warning: color('warning'), danger: color('danger'),
    success: color('success'), link: color('link'),
    night: game('night') === '1',
    skyTop: game('sky-top'), skyBottom: game('sky-bottom'), sun: game('sun'),
    cloud: game('cloud'), hill: game('hill'), hillFar: game('hill-far'),
    reed: game('reed'), reedHead: game('reed-head'),
    waterTop: game('water-top'), waterBottom: game('water-bottom'),
    foam: game('foam'), lily: game('lily'), bank: game('bank'), star: game('star'),
    duck: game('duck'), duckShade: game('duck-shade'), duckLine: game('duck-line'),
    beak: game('beak'), eye: game('eye'), armor: game('armor'), crest: game('crest'),
    egg: game('egg'), eggWarn: game('egg-warn'),
  }
}

export function drawDuck(
  ctx: CanvasRenderingContext2D, x: number, y: number, palette: Palette,
  options: { scale: number; time: number; phase: number; facing: number; flash?: boolean },
) {
  const { scale, time, phase, facing, flash } = options
  ctx.save()
  ctx.translate(Math.round(x), Math.round(y))
  ctx.scale(facing * scale, scale)
  const rect = (color: string, rx: number, ry: number, w: number, h: number) => {
    ctx.fillStyle = color
    ctx.fillRect(rx, ry, w, h)
  }
  const feather = flash ? palette.crest : palette.duck
  const outline = palette.duckLine
  const flap = Math.floor(time * 7) % 3
  rect(outline, -15, -3, 29, 14)
  rect(outline, -11, 10, 21, 4)
  rect(outline, -1, -14, 13, 16)
  rect(outline, 1, -17, 10, 6)
  rect(outline, 10, -8, 12, 8)
  rect(outline, -19, -6, 7, 10)
  rect(feather, -16, -3, 5, 6)
  rect(feather, -12, -1, 24, 10)
  rect(feather, -9, 9, 17, 3)
  rect(feather, 1, -13, 9, 14)
  rect(feather, 3, -15, 6, 4)
  rect(palette.duckShade, -12, 6, 22, 3)
  rect(palette.beak, 10, -6, 10, 4)
  rect(palette.beak, 10, -2, 7, 2)
  rect(outline, 10, -2, 10, 1)
  rect(palette.eye, 5, -10, 3, 3)
  rect(outline, 3, -12, 3, 2)
  rect(outline, 6, -11, 3, 2)
  rect(outline, -8, 3, 11, 5)
  rect(feather, -10, -3 - flap * 3, 9, 8 + flap * 2)
  rect(palette.duckShade, -8, -1 - flap * 3, 5, 6)
  rect(palette.beak, -7, 13, 6, 2)
  rect(palette.beak, 3, 13, 6, 2)
  if (phase >= 1) {
    rect(palette.crest, 0, -15, 12, 2)
    rect(palette.crest, -5, -15, 5, 2)
    rect(palette.crest, -6, -13, 3, 2)
  }
  if (phase >= 2) {
    rect(palette.armor, -10, 5, 22, 4)
    rect(outline, -3, 5, 2, 4)
    rect(palette.beak, -10, 5, 2, 3)
    rect(palette.beak, 9, 5, 2, 3)
  }
  if (phase >= 3) {
    rect(palette.eye, 0, -20, 11, 3)
    rect(palette.beak, 0, -24, 2, 4)
    rect(palette.beak, 5, -25, 2, 5)
    rect(palette.beak, 9, -24, 2, 4)
    rect(palette.eye, 5, -20, 2, 2)
  }
  ctx.restore()
}
