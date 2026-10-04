import { commitAll, listRows, nextRowId } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 防火隔离带维护批次台：
// 资料流是「防火隔离带 →（所属林区）→ 防火林带 / 巡护路线」。
// 批次落库要同时动三处：隔离带状态、防火林带补植清单、巡护路线复查事项，
// 三处先在内存里全部算完并校验，最后整份数据单次提交，任一环节失败都不写存储。

export const BATCH_KEY = 'maintenancebatch'
export const REPLANT_KEY = 'firebeltreplant'
export const FIREBELT_TODO_KEY = 'firebelttodo'
export const REVIEW_KEY = 'patrolreview'

export type BatchOperation = '割草' | '补植'
export type FailPoint = '' | 'replant' | 'review'

export type BreakCandidate = {
  id: number
  code: string
  farm: string
  region: string
  width: number
  status: string
  baseDate: string
  backfilled: boolean
  intervalDays: number
}

export type CreateBatchInput = {
  breakIds: number[]
  operation: BatchOperation
  // 故障演练：在指定写入环节抛错，用来验证三处一起回退。
  failPoint?: FailPoint
}

const DAY_MS = 24 * 60 * 60 * 1000

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function isoToday(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`).getTime()
  const end = new Date(`${to}T00:00:00`).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0
  }
  return Math.max(0, Math.floor((end - start) / DAY_MS))
}

// 旧带可能从来没登记过最近维护日期：按建成日期回填，间隔也从建成那天算起。
function maintenanceBaseDate(row: EntryRow): { date: string; backfilled: boolean } {
  const latest = text(row, '最近维护日期')
  if (latest) {
    return { date: latest, backfilled: false }
  }
  return { date: text(row, '建成日期'), backfilled: true }
}

export function listCandidates(today: string = isoToday()): BreakCandidate[] {
  return listRows('firebreak').map((row) => {
    const base = maintenanceBaseDate(row)
    return {
      id: Number(row.id),
      code: text(row, '隔离带编号'),
      farm: text(row, '所属林场'),
      region: text(row, '所属林区'),
      width: Number.parseFloat(text(row, '带宽米数')) || 0,
      status: String(row.status),
      baseDate: base.date,
      backfilled: base.backfilled,
      intervalDays: daysBetween(base.date, today),
    }
  })
}

function buildFingerprint(farm: string, operation: BatchOperation, ids: number[]): string {
  const sorted = [...ids].sort((a, b) => a - b)
  return `${farm}|${operation}|${sorted.join(',')}`
}

export function createBatch(input: CreateBatchInput): ActionResult & { batch?: EntryRow } {
  const { breakIds, operation, failPoint = '' } = input
  if (breakIds.length === 0) {
    return { ok: false, message: '请先勾选本批要安排的防火隔离带' }
  }
  if (operation !== '割草' && operation !== '补植') {
    return { ok: false, message: '维护方式只支持整组割草或整组补植' }
  }

  const breaks = listRows('firebreak')
  const selected = breakIds
    .map((id) => breaks.find((row) => Number(row.id) === id))
    .filter((row): row is EntryRow => Boolean(row))
  if (selected.length !== breakIds.length) {
    return { ok: false, message: '勾选的隔离带里有已被删除的记录，请刷新后重试' }
  }

  // 口径：同批只能来自同一林场；林区可以跨，按第一条选中带锁定林场。
  const farm = text(selected[0], '所属林场')
  if (!farm) {
    return { ok: false, message: '隔离带缺少所属林场，无法成批安排' }
  }
  const outsider = selected.find((row) => text(row, '所属林场') !== farm)
  if (outsider) {
    return {
      ok: false,
      message: `一批只能来自同一林场：${text(outsider, '隔离带编号')}不属于${farm}`,
    }
  }

  const fingerprint = buildFingerprint(farm, operation, selected.map((row) => Number(row.id)))
  const duplicate = listRows(BATCH_KEY).some(
    (row) => String(row.status) !== '已废弃' && text(row, '指纹') === fingerprint,
  )
  if (duplicate) {
    return { ok: false, message: '同一组隔离带的同方式维护批次已存在，重复提交只形成一批' }
  }

  const today = isoToday()
  const selectedIds = new Set(selected.map((row) => Number(row.id)))
  const regions = [...new Set(selected.map((row) => text(row, '所属林区')).filter(Boolean))]

  // —— 以下三处派生全部先在内存完成，任何一处抛错都直接返回，存储原样不动。——
  try {
    // 第一处：隔离带状态整组更新为「正常」，最近维护日期登记为安排日。
    const nextBreaks = breaks.map((row) =>
      selectedIds.has(Number(row.id))
        ? {
            ...row,
            status: '正常',
            // 状态枚举里「已荒废」是末态，其余都是待跟进态。
            pending: true,
            abnormal: false,
            最近维护日期: today,
            维护状态: '正常',
          }
        : row,
    )

    const nextBelts = [...listRows('firebelt')]
    const replantRows: EntryRow[] = []
    const todoRows: EntryRow[] = []

    // 第二处：补植才生成防火林带补植清单，林带待办跟着生成补植任务；割草不动林带。
    if (operation === '补植') {
      if (failPoint === 'replant') {
        throw new Error('写入防火林带补植清单失败（故障演练）')
      }
      const belts = listRows('firebelt')
      let replantId = nextRowId(REPLANT_KEY)
      let todoId = nextRowId(FIREBELT_TODO_KEY)
      const touchedBeltIds = new Set<number>()

      for (const breakRow of selected) {
        const region = text(breakRow, '所属林区')
        const matched = belts.filter((belt) => text(belt, '所属林区') === region)
        if (matched.length === 0) {
          throw new Error(`林区「${region}」没有登记防火林带，补植清单无法落库`)
        }
        for (const belt of matched) {
          touchedBeltIds.add(Number(belt.id))
          const replantNo = `RC-${String(replantId).padStart(4, '0')}`
          replantRows.push({
            id: replantId++,
            status: '待补植',
            pending: true,
            abnormal: false,
            清单编号: replantNo,
            所属林区: region,
            林带编号: text(belt, '林带编号'),
            林带名称: text(belt, '林带名称'),
            来源隔离带: text(breakRow, '隔离带编号'),
            登记日期: today,
            清单状态: '待补植',
            指纹: fingerprint,
          })
          todoRows.push({
            id: todoId++,
            status: '待执行',
            pending: true,
            abnormal: false,
            待办编号: `FT-${String(todoId - 1).padStart(4, '0')}`,
            任务名称: `${text(belt, '林带名称')}补植任务`,
            所属林区: region,
            关联清单: replantNo,
            来源隔离带: text(breakRow, '隔离带编号'),
            生成日期: today,
            待办状态: '待执行',
            指纹: fingerprint,
          })
        }
      }

      touchedBeltIds.forEach((beltId) => {
        const index = nextBelts.findIndex((belt) => Number(belt.id) === beltId)
        if (index >= 0) {
          nextBelts[index] = {
            ...nextBelts[index],
            status: '需补植',
            pending: true,
            abnormal: false,
            林带状态: '需补植',
          }
        }
      })
    }

    // 第三处：按林区找巡护路线，安排维护后的路线复查事项。
    if (failPoint === 'review') {
      throw new Error('写入巡护路线复查事项失败（故障演练）')
    }
    const patrols = listRows('patrol')
    const reviewRows: EntryRow[] = []
    let reviewId = nextRowId(REVIEW_KEY)
    for (const region of regions) {
      const routes = [...new Set(
        patrols
          .filter((row) => text(row, '巡护区域') === region)
          .map((row) => text(row, '巡护路线'))
          .filter(Boolean),
      )]
      if (routes.length === 0) {
        throw new Error(`林区「${region}」没有登记巡护路线，复查事项无法落库`)
      }
      const breakCount = selected.filter((row) => text(row, '所属林区') === region).length
      const dueDays = operation === '补植' ? 90 : 30
      for (const route of routes) {
        reviewRows.push({
          id: reviewId++,
          status: '待复查',
          pending: true,
          abnormal: false,
          复查编号: `PR-${String(reviewId - 1).padStart(4, '0')}`,
          巡护区域: region,
          巡护路线: route,
          复查内容: `${region}隔离带${operation}后${operation === '补植' ? '苗木成活' : '植被恢复'}复查（涉及${breakCount}条隔离带）`,
          计划日期: addDays(today, dueDays),
          复查状态: '待复查',
          指纹: fingerprint,
        })
      }
    }

    const batchId = nextRowId(BATCH_KEY)
    const batch: EntryRow = {
      id: batchId,
      status: '已安排',
      pending: true,
      abnormal: false,
      批次编号: `MB-${String(batchId).padStart(4, '0')}`,
      所属林场: farm,
      作业方式: operation,
      隔离带条数: selected.length,
      带宽合计米数: selected.reduce(
        (sum, row) => sum + (Number.parseFloat(text(row, '带宽米数')) || 0),
        0,
      ),
      涉及林区: regions.join('、'),
      安排日期: today,
      补植清单数: replantRows.length,
      林带待办数: todoRows.length,
      复查事项数: reviewRows.length,
      指纹: fingerprint,
    }

    // 整组提交：一次序列化、一次 localStorage 写入，失败即整体抛出由上层回退。
    commitAll({
      firebreak: nextBreaks,
      firebelt: nextBelts,
      [BATCH_KEY]: [...listRows(BATCH_KEY), batch],
      [REPLANT_KEY]: [...listRows(REPLANT_KEY), ...replantRows],
      [FIREBELT_TODO_KEY]: [...listRows(FIREBELT_TODO_KEY), ...todoRows],
      [REVIEW_KEY]: [...listRows(REVIEW_KEY), ...reviewRows],
    })

    return {
      ok: true,
      batch,
      message:
        `批次${text(batch, '批次编号')}已落库：${selected.length}条隔离带安排${operation}，` +
        `同步生成补植清单${replantRows.length}条、林带待办${todoRows.length}条、路线复查${reviewRows.length}项`,
    }
  } catch (error) {
    return {
      ok: false,
      message: `批次已整组回退，三处资料均未落库：${error instanceof Error ? error.message : '未知写入错误'}`,
    }
  }
}

export function voidBatch(id: number): ActionResult {
  const rows = listRows(BATCH_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到该维护批次' }
  }
  if (String(rows[index].status) === '已废弃') {
    return { ok: false, message: '该批次已废弃，不用重复操作' }
  }
  const next = [...rows]
  next[index] = { ...next[index], status: '已废弃', pending: false, abnormal: true }
  commitAll({ [BATCH_KEY]: next })
  return { ok: true, message: '批次已废弃，同组隔离带可以重新提交安排' }
}

function markDone(collection: string, id: number, doneStatus: string, label: string): ActionResult {
  const rows = listRows(collection)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${label}` }
  }
  if (String(rows[index].status) === doneStatus) {
    return { ok: false, message: `${label}已经${doneStatus}` }
  }
  const next = [...rows]
  next[index] = { ...next[index], status: doneStatus, pending: false, abnormal: false }
  commitAll({ [collection]: next })
  return { ok: true, message: `${label}已登记为${doneStatus}` }
}

export function completeFirebeltTodo(id: number): ActionResult {
  return markDone(FIREBELT_TODO_KEY, id, '已完成', '林带补植待办')
}

export function completeReview(id: number): ActionResult {
  return markDone(REVIEW_KEY, id, '已复查', '路线复查事项')
}
