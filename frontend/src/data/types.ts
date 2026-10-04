/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 维护方式：整组安排割草或补植，二选一。
export type MaintenanceKind = '割草' | '补植'

export type BatchCreateInput = {
  kind: MaintenanceKind
  breakIds: number[]
  operator?: string
  // 演练用：在三处写入完成后、批次落库前制造一次失败，验证整组回退。
  simulateFailure?: boolean
}

export type BatchCreateResult = ActionResult & {
  batch?: EntryRow
  replantTodos?: EntryRow[]
  patrolRecheck?: EntryRow
  duplicated?: boolean
}
