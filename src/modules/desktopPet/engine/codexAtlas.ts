// Codex hatch-pet 精灵图契约。
//
// 从 pixi-pet-demo 移植：几何常量 + 每行动画行定义 + layout 构造器。
// 仅保留几何相关部分（去掉了远程 catalog 与 URL —— 本应用从本地已下载的精灵图加载）。
//
// 精灵图规格（与 codex-pets.net 一致）：
//   - 格式：PNG 或 WebP，透明背景。
//   - 尺寸：1536 x 1872 px（v1，9 行）或 1536 x 2288 px（v2，11 行）。
//   - 网格：8 列 x N 行，每格 192 x 208。
//   - 每一行编码一个动画状态（idle, running-right, ...）。
//   - v2 在标准 9 行基础上追加 look-right-side / look-left-side 两行（各 8 帧）。

export const CODEX_ATLAS_COLS = 8
export const CODEX_ATLAS_ROWS = 9
export const CODEX_ATLAS_ROWS_V2 = 11
export const CODEX_CELL_WIDTH = 192
export const CODEX_CELL_HEIGHT = 208
export const CODEX_ATLAS_WIDTH = CODEX_ATLAS_COLS * CODEX_CELL_WIDTH // 1536
export const CODEX_ATLAS_HEIGHT = CODEX_ATLAS_ROWS * CODEX_CELL_HEIGHT // 1872（v1）
export const CODEX_ATLAS_HEIGHT_V2 = CODEX_ATLAS_ROWS_V2 * CODEX_CELL_HEIGHT // 2288（v2）

export interface CodexAtlasRow {
  // 在精灵图中从上到下的行索引。顺序与 hatch-pet 技能的 animation-rows 参考一致。
  index: number
  // 行选择引擎与 React/PixiJS keys 使用的稳定 id。
  id:
    | 'idle'
    | 'running-right'
    | 'running-left'
    | 'waving'
    | 'jumping'
    | 'failed'
    | 'waiting'
    | 'running'
    | 'review'
    // v2 扩展行（11 行图集新增，用于环顾动画）。
    | 'look-right-side'
    | 'look-left-side'
  // 该行使用的帧数。上游要求超出该索引的帧透明，因此播放上限为该数量。
  frames: number
  // 推荐 fps，使条带以与 Codex 应用相近的节奏播放。
  fps: number
}

// v1 标准 9 行（对应 hatch-pet 技能的 references/animation-rows.md）。
export const CODEX_ATLAS_ROWS_DEF: CodexAtlasRow[] = [
  { index: 0, id: 'idle', frames: 6, fps: 6 },
  { index: 1, id: 'running-right', frames: 8, fps: 8 },
  { index: 2, id: 'running-left', frames: 8, fps: 8 },
  { index: 3, id: 'waving', frames: 4, fps: 6 },
  { index: 4, id: 'jumping', frames: 5, fps: 7 },
  { index: 5, id: 'failed', frames: 8, fps: 7 },
  { index: 6, id: 'waiting', frames: 6, fps: 6 },
  { index: 7, id: 'running', frames: 6, fps: 8 },
  { index: 8, id: 'review', frames: 6, fps: 6 },
]

// v2 扩展行（在标准 9 行之后追加，各 8 帧）。
export const CODEX_ATLAS_ROWS_V2_EXTRA: CodexAtlasRow[] = [
  { index: 9, id: 'look-right-side', frames: 8, fps: 6 },
  { index: 10, id: 'look-left-side', frames: 8, fps: 6 },
]

// 校验精灵图是否符合 Codex atlas 契约。
//
// 宽度必须精确等于 1536（8 列 × 192），高度必须是 208 的整数倍（≥1 行）。
// 标准 atlas 是 9 行（1872），但 codex-pets.net 部分宠物精灵图有更多行
// （如 v2 的 11 行 = 2288）。渲染按 layout 实际行数取行，故接受任意合法行数。
// 宽度非 1536 或高度非 208 整数倍 → 拒绝（排除普通截图/自拍）。
export function looksLikeCodexAtlas(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false
  if (width <= 0 || height <= 0) return false
  if (width !== CODEX_ATLAS_WIDTH) return false
  return height % CODEX_CELL_HEIGHT === 0 && height >= CODEX_CELL_HEIGHT
}

// 描述网格 + 每行播放配置的标准 layout 对象。渲染器据此切片并知道有哪些行。
//
// rowCount 由调用方按图集实际高度推断（通常 = textures.cells.length）：
//   - ≤9 行 → v1 标准 9 行状态表
//   - ≥11 行 → 完整 11 行（v1 + v2 扩展环顾行）
//   - 中间行数（10 行等非标准）按实际可用行数截取，保证不越界。
export function buildCodexAtlasLayout(
  rowCount: number = CODEX_ATLAS_ROWS
): {
  cols: number
  rows: number
  rowsDef: { index: number; id: string; frames: number; fps: number }[]
} {
  let def = CODEX_ATLAS_ROWS_DEF
  if (rowCount >= CODEX_ATLAS_ROWS_V2) {
    def = [...CODEX_ATLAS_ROWS_DEF, ...CODEX_ATLAS_ROWS_V2_EXTRA]
  } else if (rowCount < CODEX_ATLAS_ROWS) {
    // 非标准行数：截取实际拥有的行，避免引用不存在的图集行。
    def = CODEX_ATLAS_ROWS_DEF.slice(0, Math.max(0, rowCount))
  }
  return {
    cols: CODEX_ATLAS_COLS,
    rows: def.length,
    rowsDef: def.map((row) => ({
      index: row.index,
      id: row.id,
      frames: row.frames,
      fps: row.fps,
    })),
  }
}
