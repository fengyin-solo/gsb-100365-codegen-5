import { commitAll, listRows } from '@/data/local-store'
import type {
  BatchCreateInput,
  BatchCreateResult,
  EntryRow,
  MaintenanceKind,
} from '@/data/types'

// 维护批次台的领域逻辑：隔离带 → 防火林带 → 补植待办 / 巡护复查 的资料流向都收在这里。

// 选择口径：林场按所属林区 1:1 归口，同一批次只能勾选同一林区（即同一林场）的隔离带。
const FOREST_FARM_OF_REGION: Record<string, string> = {
  东山林区: '青峰林场',
  西坡林区: '西坡林场',
  南溪林区: '云岭林场',
  北岭林区: '北岭林场',
}

export function forestFarmOfRegion(region: string): string {
  return FOREST_FARM_OF_REGION[region] ?? `${region}管护林场`
}

export const MAINTENANCE_KINDS: MaintenanceKind[] = ['割草', '补植']

export const BATCH_BUCKET = 'firebreakbatch'
export const REPLANT_TODO_BUCKET = 'firebelttodo'

export type BatchBreakRow = EntryRow & {
  所属林场: string
  维护基准日期: string
  日期回填: boolean
  间隔天数: number | ''
}

// 缺失最近维护日期的旧带，按建成日期回填为维护基准日。
export function lastMaintainedDate(row: EntryRow): string {
  const recent = String(row['最近维护日期'] ?? '').trim()
  if (recent !== '') {
    return recent
  }
  return String(row['建成日期'] ?? '').trim()
}

export function isDateBackfilled(row: EntryRow): boolean {
  return String(row['最近维护日期'] ?? '').trim() === ''
    && String(row['建成日期'] ?? '').trim() !== ''
}

function toDayStart(value: string): number {
  return new Date(`${value}T00:00:00`).getTime()
}

export function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function addDays(iso: string, days: number): string {
  const time = toDayStart(iso)
  if (Number.isNaN(time)) {
    return iso
  }
  const target = new Date(time + days * 24 * 60 * 60 * 1000)
  const month = String(target.getMonth() + 1).padStart(2, '0')
  const day = String(target.getDate()).padStart(2, '0')
  return `${target.getFullYear()}-${month}-${day}`
}

export function intervalDays(row: EntryRow, today: string = todayIso()): number | null {
  const base = lastMaintainedDate(row)
  if (!base || Number.isNaN(toDayStart(base)) || Number.isNaN(toDayStart(today))) {
    return null
  }
  return Math.round((toDayStart(today) - toDayStart(base)) / (24 * 60 * 60 * 1000))
}

// 批次台列表：给隔离带补上林场、维护间隔等派生字段，供页面多选与展示。
export function listBatchBreaks(): BatchBreakRow[] {
  const today = todayIso()
  return listRows('firebreak').map((row) => {
    const days = intervalDays(row, today)
    return {
      ...row,
      所属林场: forestFarmOfRegion(String(row['所属林区'] ?? '')),
      维护基准日期: lastMaintainedDate(row),
      日期回填: isDateBackfilled(row),
      间隔天数: days === null ? '' : days,
    }
  })
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function codeOf(row: EntryRow, field = '隔离带编号'): string {
  return String(row[field] ?? '')
}

function widthOf(row: EntryRow): number {
  const value = Number(row['带宽米数'])
  return Number.isFinite(value) ? value : 0
}

// 同一批隔离带 + 同一维护方式构成幂等指纹；只对未结案的批次查重。
function fingerprintOf(kind: MaintenanceKind, ids: number[]): string {
  return `${kind}|${[...ids].sort((a, b) => a - b).join(',')}`
}

const OPEN_BATCH_STATUSES = ['待作业', '作业中']

export function listBatches(): EntryRow[] {
  return listRows(BATCH_BUCKET)
}

export function listReplantTodos(): EntryRow[] {
  return listRows(REPLANT_TODO_BUCKET)
}

// 巡护路线复查事项挂在巡护任务桶里，用「关联批次」标记与常规巡护任务区分。
export function listRecheckPatrols(): EntryRow[] {
  return listRows('patrol').filter((row) => Boolean(row['关联批次']))
}

function nextBatchNo(batches: EntryRow[]): string {
  const seq = String(batches.length + 1).padStart(3, '0')
  return `WHP-${todayIso().split('-').join('')}-${seq}`
}

// 安排一批维护：三处写入在同一个 commitAll 草稿里完成，任一环节抛错整组回退。
export function createMaintenanceBatch(input: BatchCreateInput): BatchCreateResult {
  const kind = input.kind
  if (!MAINTENANCE_KINDS.includes(kind)) {
    return { ok: false, message: `维护方式「${kind}」不支持，只能整组安排割草或补植` }
  }
  const ids = [...new Set(input.breakIds)].sort((a, b) => a - b)
  if (ids.length === 0) {
    return { ok: false, message: '请先勾选本批要安排维护的防火隔离带' }
  }

  const breaks = listRows('firebreak')
  const picked = ids
    .map((id) => breaks.find((row) => Number(row.id) === id))
    .filter((row): row is EntryRow => Boolean(row))
  if (picked.length !== ids.length) {
    return { ok: false, message: '勾选的隔离带中有记录已不存在，请刷新后重选' }
  }

  const regions = new Set(picked.map((row) => String(row['所属林区'] ?? '')))
  if (regions.size > 1) {
    return {
      ok: false,
      message: `同批只能来自同一林场，当前勾选横跨 ${[...regions].join('、')}，请按林场拆分批次`,
    }
  }
  const region = [...regions][0]
  const farm = forestFarmOfRegion(region)

  // 重复提交只形成一批：同组隔离带、同种维护方式且批次尚未结案时，直接返回原批次。
  const fingerprint = fingerprintOf(kind, ids)
  const existed = listRows(BATCH_BUCKET).find(
    (row) => String(row['指纹'] ?? '') === fingerprint
      && OPEN_BATCH_STATUSES.includes(String(row.status)),
  )
  if (existed) {
    return {
      ok: true,
      duplicated: true,
      batch: existed,
      message: `该组隔离带的${kind}批次已存在（${codeOf(existed, '批次编号')}），重复提交只形成一批`,
    }
  }

  // 顺着资料流向找同林区防火林带：补植批次必须跟着生成至少一条补植待办。
  const belts = listRows('firebelt').filter((row) => String(row['所属林区'] ?? '') === region)
  const beltsToReplant = kind === '补植'
    ? belts.filter((row) => ['有缺株', '需补植', '已退化'].includes(String(row.status)))
    : []
  if (kind === '补植' && beltsToReplant.length === 0) {
    return {
      ok: false,
      message: `${region}（${farm}）暂无缺株/需补植的防火林带，安排补植无法生成补植任务，请改安排割草`,
    }
  }

  try {
    let createdBatch: EntryRow | undefined
    let createdTodos: EntryRow[] = []
    let createdRecheck: EntryRow | undefined

    commitAll((draft) => {
      const batchRows = draft[BATCH_BUCKET] ?? []
      const todoRows = draft[REPLANT_TODO_BUCKET] ?? []
      const patrolRows = draft['patrol'] ?? []
      const breakRows = draft.firebreak ?? []

      const batchNo = nextBatchNo(batchRows)
      const today = todayIso()
      const recheckDate = addDays(today, kind === '割草' ? 7 : 30)
      const breakCodes = picked.map((row) => codeOf(row)).join('、')

      // 第一处：更新隔离带状态（安排维护 → 需割草 / 需补植），维护日期保持不变，等作业完成再更新。
      const targetStatus = kind === '割草' ? '需割草' : '需补植'
      const pickedIndex = new Set(picked.map((row) => row.id))
      draft.firebreak = breakRows.map((row) => {
        if (!pickedIndex.has(row.id)) {
          return row
        }
        return {
          ...row,
          status: targetStatus,
          pending: true,
          维护状态: `已安排${kind}·${batchNo}`,
        }
      })

      // 第二处：防火林带待办跟着补植批次生成补植任务（割草不产生补植清单）。
      if (kind === '补植') {
        draft[REPLANT_TODO_BUCKET] = [
          ...todoRows,
          ...beltsToReplant.map((belt, index) => {
            const todoId = todoRows.length + index + 1
            return {
              id: todoId,
              status: '待补植',
              pending: true,
              abnormal: false,
              待办编号: `BZ-${String(todoId).padStart(4, '0')}`,
              关联批次: batchNo,
              林带编号: codeOf(belt, '林带编号'),
              林带名称: codeOf(belt, '林带名称'),
              所属林区: region,
              林带宽度: belt['林带宽度'] ?? '',
              来源隔离带: breakCodes,
              计划完工日: recheckDate,
            }
          }),
        ]
        createdTodos = draft[REPLANT_TODO_BUCKET].filter((row) => row['关联批次'] === batchNo)
      } else {
        draft[REPLANT_TODO_BUCKET] = todoRows
      }

      // 第三处：巡护路线复查事项，一批一条，复查路线串起本批隔离带。
      const patrolId = nextId(patrolRows)
      createdRecheck = {
        id: patrolId,
        status: '待执行',
        pending: true,
        abnormal: false,
        任务编号: `XCCL-${String(patrolId).padStart(4, '0')}`,
        巡护区域: region,
        巡护路线: `${breakCodes} 沿线隔离带维护复查`,
        巡护员: '待派工',
        巡护日期: recheckDate,
        巡护时段: '白天班',
        发现火情数: 0,
        任务状态: '待执行',
        复查事项: '是',
        关联批次: batchNo,
        维护方式: kind,
      }
      draft.patrol = [...patrolRows, createdRecheck]

      // 演练开关：在批次台账落库前制造失败，验证三处写入一起回退。
      if (input.simulateFailure) {
        throw new Error('批次台账写入失败（故障演练）：隔离带状态、补植清单、复查事项已整组回退')
      }

      const totalWidth = picked.reduce((sum, row) => sum + widthOf(row), 0)
      createdBatch = {
        id: nextId(batchRows),
        status: '待作业',
        pending: true,
        abnormal: false,
        批次编号: batchNo,
        所属林场: farm,
        所属林区: region,
        维护方式: kind,
        隔离带条数: picked.length,
        带宽合计米数: totalWidth,
        安排日期: today,
        计划复查日: recheckDate,
        隔离带编号: breakCodes,
        经办人: input.operator?.trim() || '值班调度',
        指纹: fingerprint,
      }
      draft[BATCH_BUCKET] = [...batchRows, createdBatch]
    })

    return {
      ok: true,
      batch: createdBatch,
      replantTodos: createdTodos,
      patrolRecheck: createdRecheck,
      message: `${kind}批次 ${codeOf(createdBatch as EntryRow, '批次编号')} 已落库：`
        + `${picked.length} 条隔离带已安排，`
        + (createdTodos.length > 0 ? `生成补植任务 ${createdTodos.length} 条，` : '')
        + '巡护复查事项已同步',
    }
  } catch (error) {
    // commitAll 中途抛错：草稿被整体丢弃，三个桶的旧数据原封不动。
    return {
      ok: false,
      message: error instanceof Error ? error.message : '批次落库失败，已整组回退',
    }
  }
}
