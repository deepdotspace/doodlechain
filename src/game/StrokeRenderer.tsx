/**
 * StrokeRenderer — renders a strokes payload (the canonical wire format:
 * `{ color, width, points:[x0,y0,...] }[]` in normalized 0..1 space) as a
 * crisp, resolution-independent SVG. Used by the guess phase (view the drawing
 * you must caption) and the slideshow. Accepts either the parsed array or the
 * raw JSON string the engine stores.
 *
 * Width is expressed against a 1000-unit reference, so a stroke reads the same
 * proportionally at any display size.
 */

import { useMemo } from 'react'
import type { Stroke } from './types'

const REF = 1000

export function parseStrokes(raw: string | Stroke[] | undefined | null): Stroke[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Stroke[]) : []
  } catch {
    return []
  }
}

function toPath(points: number[]): string {
  if (points.length < 2) return ''
  let d = `M ${points[0] * REF} ${points[1] * REF}`
  for (let i = 2; i < points.length - 1; i += 2) {
    d += ` L ${points[i] * REF} ${points[i + 1] * REF}`
  }
  return d
}

interface StrokeRendererProps {
  strokes: string | Stroke[] | undefined | null
  className?: string
  /** Background fill of the drawing surface. Defaults to paper white. */
  background?: string
}

export function StrokeRenderer({ strokes, className, background = '#ffffff' }: StrokeRendererProps) {
  const parsed = useMemo(() => parseStrokes(strokes), [strokes])
  const empty = parsed.length === 0

  return (
    <svg
      viewBox={`0 0 ${REF} ${REF}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', width: '100%', height: '100%', background }}
      role="img"
      aria-label="drawing"
    >
      {parsed.map((s, i) => {
        if (s.points.length === 2) {
          // A single dot — render as a filled circle so taps are visible.
          return (
            <circle
              key={i}
              cx={s.points[0] * REF}
              cy={s.points[1] * REF}
              r={Math.max(1, s.width) / 2}
              fill={s.color}
            />
          )
        }
        return (
          <path
            key={i}
            d={toPath(s.points)}
            fill="none"
            stroke={s.color}
            strokeWidth={Math.max(1, s.width)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
      {empty && (
        <text
          x={REF / 2}
          y={REF / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="42"
          fill="#bdb6a8"
          fontFamily="system-ui, sans-serif"
        >
          (no drawing)
        </text>
      )}
    </svg>
  )
}
