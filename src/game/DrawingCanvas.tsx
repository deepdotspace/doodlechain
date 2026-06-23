/**
 * DrawingCanvas — the stroke-based drawing surface for the DRAW phase.
 *
 * Captures pointer input and stores strokes in the canonical wire format
 * (`{ color, width, points:[x0,y0,...] }` normalized to 0..1, width against a
 * 1000-unit reference) so a drawing renders identically here, in the guess
 * phase, and in the slideshow regardless of display size. Paints onto an opaque
 * white surface, so the "eraser" is simply a white brush.
 *
 * Exposes an imperative handle for the phase UI: read the strokes JSON on
 * submit, plus undo / clear / color / width.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { Stroke } from './types'
import { MAX_POINTS_PER_STROKE, MAX_STROKES } from './config'

const REF = 1000

/** Ink palette — high contrast on white, broad enough for expressive doodles. */
export const PALETTE = [
  '#1c1a17', // ink
  '#e8553b', // vermilion
  '#f2a93b', // marigold
  '#2d8a6d', // pine
  '#3b6fd4', // cobalt
  '#7a52d6', // grape
  '#c0418f', // magenta
  '#8a5a2b', // umber
  '#ffffff', // eraser (white)
] as const

/** Brush widths against the 1000-unit reference. */
export const BRUSH_WIDTHS = [4, 8, 14, 22, 34] as const

export interface DrawingCanvasHandle {
  getStrokes(): Stroke[]
  getStrokesJson(): string
  isEmpty(): boolean
  clear(): void
  undo(): void
  setColor(color: string): void
  setWidth(width: number): void
}

interface DrawingCanvasProps {
  className?: string
  disabled?: boolean
  /** Pixel resolution of the backing canvas (display is responsive via CSS). */
  resolution?: number
  color: string
  width: number
  onChange?: (count: number) => void
}

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas({ className, disabled = false, resolution = 1000, color, width, onChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const [strokes, setStrokes] = useState<Stroke[]>([])
    const drawing = useRef<{ stroke: Stroke | null; pointerId: number | null }>({
      stroke: null,
      pointerId: null,
    })
    // Live color/width without re-installing handlers.
    const styleRef = useRef({ color, width })
    styleRef.current = { color, width }

    useImperativeHandle(
      ref,
      () => ({
        getStrokes: () => strokes,
        getStrokesJson: () => JSON.stringify(strokes),
        isEmpty: () => strokes.length === 0,
        clear: () => setStrokes([]),
        undo: () => setStrokes((p) => p.slice(0, -1)),
        setColor: (c) => (styleRef.current = { ...styleRef.current, color: c }),
        setWidth: (w) => (styleRef.current = { ...styleRef.current, width: w }),
      }),
      [strokes],
    )

    useEffect(() => {
      onChange?.(strokes.length)
    }, [strokes.length, onChange])

    // Full redraw whenever strokes change.
    useEffect(() => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const px = canvas.width
      ctx.clearRect(0, 0, px, px)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, px, px)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const scale = px / REF
      for (const s of strokes) drawStroke(ctx, s, scale)
    }, [strokes, resolution])

    const localPoint = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
      const canvas = canvasRef.current
      if (!canvas) return [0, 0]
      const rect = canvas.getBoundingClientRect()
      const x = clamp01((e.clientX - rect.left) / rect.width)
      const y = clamp01((e.clientY - rect.top) / rect.height)
      return [x, y]
    }

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return
      e.preventDefault()
      const canvas = canvasRef.current
      if (!canvas) return
      if (strokes.length >= MAX_STROKES) return // bound the payload at the source
      canvas.setPointerCapture(e.pointerId)
      const [x, y] = localPoint(e)
      drawing.current = {
        stroke: { color: styleRef.current.color, width: styleRef.current.width, points: [x, y] },
        pointerId: e.pointerId,
      }
    }

    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const d = drawing.current
      if (!d.stroke || d.pointerId !== e.pointerId) return
      // Cap points per stroke so a long high-Hz drag can't grow unbounded.
      if (d.stroke.points.length >= MAX_POINTS_PER_STROKE * 2) return
      const [x, y] = localPoint(e)
      d.stroke.points.push(x, y)
      // Incremental segment for responsiveness.
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const scale = canvas.width / REF
      const pts = d.stroke.points
      const n = pts.length
      ctx.strokeStyle = d.stroke.color
      ctx.lineWidth = Math.max(1, d.stroke.width) * scale
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(pts[n - 4] * canvas.width, pts[n - 3] * canvas.width)
      ctx.lineTo(pts[n - 2] * canvas.width, pts[n - 1] * canvas.width)
      ctx.stroke()
    }

    const finish = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const d = drawing.current
      if (!d.stroke || d.pointerId !== e.pointerId) return
      const s = d.stroke
      drawing.current = { stroke: null, pointerId: null }
      setStrokes((prev) => [...prev, s])
    }

    return (
      <canvas
        ref={canvasRef}
        width={resolution}
        height={resolution}
        data-testid="drawing-canvas"
        className={className}
        style={{
          display: 'block',
          width: '100%',
          aspectRatio: '1 / 1',
          touchAction: 'none',
          userSelect: 'none',
          cursor: disabled ? 'default' : 'crosshair',
          background: '#ffffff',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
    )
  },
)

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, scale: number): void {
  if (s.points.length < 2) return
  ctx.strokeStyle = s.color
  ctx.lineWidth = Math.max(1, s.width) * scale
  const px = ctx.canvas.width
  if (s.points.length === 2) {
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.arc(s.points[0] * px, s.points[1] * px, (Math.max(1, s.width) * scale) / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(s.points[0] * px, s.points[1] * px)
  for (let i = 2; i < s.points.length - 1; i += 2) {
    ctx.lineTo(s.points[i] * px, s.points[i + 1] * px)
  }
  ctx.stroke()
}
