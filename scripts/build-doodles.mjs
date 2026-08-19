/**
 * build-doodles.mjs — one-time / occasional build tool (NOT shipped, NOT run at
 * runtime). Fetches a curated set of Google "Quick, Draw!" categories, keeps the
 * cleanest recognized human doodles, converts them to the app's normalized 0..1
 * stroke space, and writes a compact packed bundle to src/game/doodles.data.json.
 *
 * It is SELF-VALIDATING: it checks every candidate against the authoritative
 * category list, retries transient fetch failures, and THROWS if any candidate
 * yields no doodles — so it can never silently ship an incomplete pack. A blank
 * artifact is far worse than a loud failure (every bot would draw the fallback blob).
 *
 * Packed format keeps the asset small (ink colour + width are applied at read
 * time in src/game/doodles.ts):
 *   { "<category>": [ drawing, ... ], ... }
 *   drawing = [ stroke, ... ]
 *   stroke  = [x, y, x, y, ...]   (decimals 0..1, 3dp)
 *
 * Data: Google "Quick, Draw!" dataset, CC BY 4.0.
 * Run:  node scripts/build-doodles.mjs
 */
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
const pexec = promisify(execFile)

const PER_CATEGORY = 12
const MIN_STROKES = 1
const MAX_STROKES = 24
const MIN_POINTS = 14 // total (x,y) pairs across all strokes
const MAX_POINTS = 340
const FETCH_LINES = 90
const RETRIES = 3

const CATEGORIES_URL = 'https://raw.githubusercontent.com/googlecreativelab/quickdraw-dataset/master/categories.txt'

// Curated, family-friendly, recognizable categories. Every name MUST be an exact
// Quick,Draw! category (the script asserts this against CATEGORIES_URL and fails
// loudly on a typo or a non-existent noun).
const CANDIDATES = [
  // animals
  'cat', 'dog', 'bird', 'fish', 'frog', 'duck', 'owl', 'penguin', 'elephant', 'lion',
  'tiger', 'bear', 'panda', 'monkey', 'giraffe', 'zebra', 'horse', 'cow', 'pig', 'sheep',
  'rabbit', 'mouse', 'snail', 'snake', 'spider', 'bee', 'butterfly', 'ant', 'crab', 'octopus',
  'dolphin', 'whale', 'shark', 'sea turtle', 'dragon', 'camel', 'kangaroo', 'rhinoceros',
  'hedgehog', 'squirrel', 'raccoon', 'bat', 'flamingo', 'parrot', 'crocodile', 'lobster', 'scorpion',
  // food
  'apple', 'banana', 'birthday cake', 'cake', 'bread', 'pizza', 'hamburger', 'hot dog', 'ice cream',
  'donut', 'cookie', 'carrot', 'broccoli', 'mushroom', 'strawberry', 'grapes', 'pineapple',
  'watermelon', 'peanut', 'popsicle', 'sandwich', 'steak', 'potato', 'onion', 'pear', 'blueberry',
  'wine bottle',
  // vehicles + objects
  'house', 'tree', 'car', 'bus', 'truck', 'bicycle', 'airplane', 'helicopter', 'train', 'sailboat',
  'submarine', 'tractor', 'ambulance', 'school bus', 'cruise ship', 'hot air balloon',
  'clock', 'alarm clock', 'wristwatch', 'hourglass', 'cell phone', 'computer', 'laptop', 'television',
  'camera', 'book', 'pencil', 'scissors', 'hammer', 'saw', 'axe', 'sword', 'umbrella', 'hat', 'crown',
  'shoe', 'sock', 't-shirt', 'pants', 'eyeglasses', 'backpack', 'ladder', 'chair', 'table', 'bed',
  'door', 'light bulb', 'candle', 'lantern', 'cup', 'wine glass', 'fork', 'spoon', 'knife', 'bucket',
  'broom', 'key', 'map', 'envelope', 'guitar', 'piano', 'drums', 'trumpet', 'violin', 'microphone',
  'headphones', 'dumbbell', 'toothbrush', 'lighthouse', 'castle', 'tent', 'bridge', 'windmill',
  'traffic light', 'stop sign', 'The Eiffel Tower', 'roller coaster',
  // nature + fun
  'sun', 'moon', 'star', 'cloud', 'rainbow', 'snowflake', 'flower', 'cactus', 'palm tree', 'mountain',
  'lightning', 'tornado', 'leaf', 'snowman', 'campfire', 'angel', 'skull', 'diamond',
  // people bits
  'face', 'smiley face', 'eye', 'mouth', 'nose', 'ear', 'hand', 'foot', 'moustache', 'tooth',
]

const round = (n) => Math.round(n * 1000) / 1000

async function fetchText(url) {
  const { stdout } = await pexec('bash', ['-c', `curl -s --max-time 45 "${url}"`], { maxBuffer: 1 << 24 })
  return stdout
}

async function fetchRows(cat) {
  const url = `https://storage.googleapis.com/quickdraw_dataset/full/simplified/${encodeURIComponent(cat)}.ndjson`
  const { stdout } = await pexec('bash', ['-c', `curl -s --max-time 45 "${url}" | head -n ${FETCH_LINES}`], {
    maxBuffer: 1 << 26,
  })
  return stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

function usable(rows) {
  return rows
    .filter((r) => r.recognized && Array.isArray(r.drawing) && r.drawing.length >= MIN_STROKES && r.drawing.length <= MAX_STROKES)
    .filter((r) => { const p = r.drawing.reduce((n, [xs]) => n + xs.length, 0); return p >= MIN_POINTS && p <= MAX_POINTS })
    .slice(0, PER_CATEGORY)
}

function pack(drawing) {
  return drawing.map(([xs, ys]) => {
    const pts = []
    for (let i = 0; i < xs.length; i++) pts.push(round(xs[i] / 255), round(ys[i] / 255))
    return pts
  })
}

// --- validate the candidate list against the authoritative category set --------
const valid = new Set((await fetchText(CATEGORIES_URL)).split('\n').map((s) => s.trim()).filter(Boolean))
if (valid.size < 300) throw new Error(`category list looks wrong (${valid.size} entries) — aborting`)
const uniq = [...new Set(CANDIDATES)]
const notCategories = uniq.filter((c) => !valid.has(c))
if (notCategories.length) {
  throw new Error(`These CANDIDATES are not Quick,Draw! categories (fix the list):\n  ${notCategories.join(', ')}`)
}

// --- fetch each (with retry) and require doodles for every one -----------------
const out = {}
let kept = 0
for (const cat of uniq) {
  let good = []
  for (let attempt = 1; attempt <= RETRIES && good.length === 0; attempt++) {
    try { good = usable(await fetchRows(cat)) } catch (e) { process.stderr.write(`  ${cat} attempt ${attempt}: ${e.message}\n`) }
  }
  if (good.length === 0) throw new Error(`No usable doodles for "${cat}" after ${RETRIES} tries — aborting (transient? re-run)`)
  out[cat] = good.map((r) => pack(r.drawing))
  kept += good.length
  process.stderr.write(`${cat}: ${good.length}\n`)
}

if (Object.keys(out).length !== uniq.length) {
  throw new Error(`incomplete pack: ${Object.keys(out).length}/${uniq.length} categories`)
}

const json = JSON.stringify(out)
writeFileSync(new URL('../src/game/doodles.data.json', import.meta.url), json)
console.log(`\nwrote src/game/doodles.data.json — ${Object.keys(out).length}/${uniq.length} categories, ${kept} doodles, ${(json.length / 1e6).toFixed(2)}MB`)
