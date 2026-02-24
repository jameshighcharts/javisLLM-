const TASK_COLOR_PALETTE = ['#87B98E', '#D9A579', '#7FA3D2', '#B8A27E', '#A38BB6', '#90B79E', '#7AAEB0']

function hashTaskId(taskId: string): number {
  let hash = 0
  for (let index = 0; index < taskId.length; index += 1) {
    hash = (hash * 31 + taskId.charCodeAt(index)) % 2_147_483_647
  }
  return Math.abs(hash)
}

export function buildTaskColorMap(taskIds: string[]): Map<string, string> {
  const uniqueIds = [...new Set(taskIds)].sort((left, right) => left.localeCompare(right))
  const paletteSize = TASK_COLOR_PALETTE.length
  const map = new Map<string, string>()
  if (paletteSize === 0) return map

  const used = new Array<boolean>(paletteSize).fill(false)
  for (const taskId of uniqueIds) {
    const preferredSlot = hashTaskId(taskId) % paletteSize
    let slot = preferredSlot
    let attempts = 0
    while (attempts < paletteSize && used[slot]) {
      slot = (slot + 1) % paletteSize
      attempts += 1
    }

    const resolvedSlot = attempts < paletteSize ? slot : preferredSlot
    used[resolvedSlot] = true
    map.set(taskId, TASK_COLOR_PALETTE[resolvedSlot])
  }
  return map
}

export function getTaskColorById(taskId: string, colorMap?: Map<string, string>): string {
  const mapped = colorMap?.get(taskId)
  if (mapped) return mapped
  const hash = hashTaskId(taskId)
  return TASK_COLOR_PALETTE[Math.abs(hash) % TASK_COLOR_PALETTE.length]
}
