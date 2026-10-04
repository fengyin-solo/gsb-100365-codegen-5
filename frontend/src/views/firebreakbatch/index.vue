<template>
  <section class="page" data-module="firebreakbatch">
    <header class="page-head">
      <div>
        <h2>防火隔离带维护批次台</h2>
        <p class="page-desc">
          按所属林区和维护状态多选隔离带，整组安排割草或补植；同批只能来自同一林场（林区即林场归口）。
          批次落库同步更新隔离带状态、防火林带补植清单与巡护路线复查事项，任一失败三处一起回退。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportBatches">导出批次台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">筛选后隔离带</span>
        <strong class="stat-value">{{ filteredBreaks.length }} 条</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已勾选</span>
        <strong class="stat-value">{{ selectedIds.length }} 条</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">勾选带宽合计</span>
        <strong class="stat-value">{{ selectedTotalWidth }} 米</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待作业批次</span>
        <strong class="stat-value">{{ openBatchCount }} 批</strong>
      </article>
    </div>

    <!-- 多选筛选：所属林区、维护状态 -->
    <div class="filter-panel">
      <div class="filter-group">
        <span class="filter-label">所属林区（多选）</span>
        <div class="chip-row">
          <button
            v-for="region in regionOptions"
            :key="region"
            type="button"
            class="chip"
            :class="{ active: selectedRegions.includes(region) }"
            @click="toggleRegion(region)"
          >
            {{ region }}
          </button>
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">维护状态（多选）</span>
        <div class="chip-row">
          <button
            v-for="status in statusOptions"
            :key="status"
            type="button"
            class="chip"
            :class="{ active: selectedStatuses.includes(status) }"
            @click="toggleStatus(status)"
          >
            {{ status }}
          </button>
        </div>
      </div>
      <div class="filter-group drill-row">
        <label class="drill-check">
          <input v-model="simulateFailure" type="checkbox" />
          故障演练：模拟批次台账写入失败，验证三处写入整组回退
        </label>
        <button class="btn ghost" type="button" @click="clearFilters">清空筛选</button>
      </div>
    </div>

    <!-- 勾选汇总与整组操作 -->
    <div class="batch-bar">
      <div class="batch-summary">
        <template v-if="selectedRows.length">
          <span>本批归口林场：<strong>{{ selectedFarm }}</strong></span>
          <span>所属林区：{{ selectedRegion ?? '—' }}</span>
          <span>{{ selectedRows.length }} 条 · 带宽合计 {{ selectedTotalWidth }} 米</span>
        </template>
        <span v-else class="muted">尚未勾选隔离带，可按上方林区、维护状态筛选后在表格中多选。</span>
      </div>
      <div class="batch-actions">
        <button
          class="btn primary"
          type="button"
          :disabled="!canSubmit || submitting"
          @click="submitBatch('割草')"
        >
          整组安排割草
        </button>
        <button
          class="btn primary"
          type="button"
          :disabled="!canSubmit || submitting"
          @click="submitBatch('补植')"
        >
          整组安排补植
        </button>
      </div>
    </div>
    <p v-if="feedback" class="feedback" :class="feedback.type">{{ feedback.text }}</p>

    <table class="data-table pick-table">
      <thead>
        <tr>
          <th class="pick-col">
            <input
              type="checkbox"
              :checked="allFilteredSelected"
              :disabled="filteredSelectable.length === 0"
              @change="toggleSelectAll"
            />
          </th>
          <th v-for="column in breakColumns" :key="column">{{ column }}</th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredBreaks" :key="String(row.id)" :class="{ picked: selectedIds.includes(row.id) }">
          <td class="pick-col">
            <input
              type="checkbox"
              :checked="selectedIds.includes(row.id)"
              :disabled="!isSelectable(row)"
              @change="toggleRow(row)"
            />
          </td>
          <td>{{ row['隔离带编号'] }}</td>
          <td>{{ row['所属林场'] }}</td>
          <td>{{ row['所属林区'] }}</td>
          <td>{{ row['起止坐标'] }}</td>
          <td>{{ row['带宽米数'] }}</td>
          <td>{{ row['建成日期'] || '—' }}</td>
          <td>{{ row['最近维护日期'] || '—' }}</td>
          <td>
            {{ row['维护基准日期'] || '—' }}
            <span v-if="row['日期回填']" class="tag warn" title="缺失最近维护日期，按建成日期回填">建成回填</span>
          </td>
          <td>
            <span v-if="row['间隔天数'] === ''">—</span>
            <span v-else>{{ row['间隔天数'] }} 天</span>
          </td>
          <td>{{ row.status }}</td>
        </tr>
        <tr v-if="!filteredBreaks.length">
          <td :colspan="breakColumns.length + 2" class="empty-state">当前筛选条件下没有防火隔离带</td>
        </tr>
      </tbody>
    </table>
    <p class="pick-hint">同批只能来自同一林场：已勾选一个林区后，其他林区的勾选框会自动禁用。</p>

    <h3 class="section-title">维护批次台账</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in batchColumns" :key="column">{{ column }}</th>
          <th>批次状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in batches" :key="String(row.id)">
          <td v-for="column in batchColumns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in batchActions"
              :key="action"
              class="link"
              type="button"
              @click="applyBatchAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!batches.length">
          <td :colspan="batchColumns.length + 2" class="empty-state">还没有维护批次，勾选隔离带后整组安排。</td>
        </tr>
      </tbody>
    </table>

    <div class="sub-head">
      <h3 class="section-title">联动生成事项</h3>
      <div class="tab-row">
        <button
          class="tab"
          :class="{ active: tab === 'todo' }"
          type="button"
          @click="tab = 'todo'"
        >
          防火林带补植清单（{{ replantTodos.length }}）
        </button>
        <button
          class="tab"
          :class="{ active: tab === 'recheck' }"
          type="button"
          @click="tab = 'recheck'"
        >
          巡护路线复查事项（{{ recheckPatrols.length }}）
        </button>
      </div>
    </div>

    <table v-if="tab === 'todo'" class="data-table">
      <thead>
        <tr>
          <th v-for="column in todoColumns" :key="column">{{ column }}</th>
          <th>任务状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in replantTodos" :key="String(row.id)">
          <td v-for="column in todoColumns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in todoActions"
              :key="action"
              class="link"
              type="button"
              @click="applyTodoAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!replantTodos.length">
          <td :colspan="todoColumns.length + 2" class="empty-state">补植批次落库后，防火林带待办会在这里跟着生成补植任务。</td>
        </tr>
      </tbody>
    </table>

    <table v-else class="data-table">
      <thead>
        <tr>
          <th v-for="column in recheckColumns" :key="column">{{ column }}</th>
          <th>任务状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in recheckPatrols" :key="String(row.id)">
          <td v-for="column in recheckColumns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in patrolActions"
              :key="action"
              class="link"
              type="button"
              @click="applyPatrolAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!recheckPatrols.length">
          <td :colspan="recheckColumns.length + 2" class="empty-state">批次落库后，巡护路线复查事项会在这里生成。</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  listBatches,
  listBatchBreaks,
  listRecheckPatrols,
  listReplantTodos,
  createMaintenanceBatch,
  type BatchBreakRow,
} from '@/api/firebreak-batch'
import { downloadEntries, runAction } from '@/api/local-service'
import type { EntryRow, MaintenanceKind } from '@/data/types'

const breakColumns = [
  '隔离带编号', '所属林场', '所属林区', '起止坐标', '带宽米数',
  '建成日期', '最近维护日期', '维护基准日期', '距上次维护',
]
const batchColumns = [
  '批次编号', '所属林场', '所属林区', '维护方式', '隔离带条数',
  '带宽合计米数', '安排日期', '计划复查日',
]
const todoColumns = [
  '待办编号', '关联批次', '林带编号', '林带名称', '所属林区', '林带宽度', '来源隔离带', '计划完工日',
]
const recheckColumns = [
  '任务编号', '关联批次', '维护方式', '巡护区域', '巡护路线', '巡护员', '巡护日期',
]

const statusOptions = ['正常', '需割草', '需补植', '已荒废']
const batchActions = ['开始作业', '完成作业', '确认复查']
const todoActions = ['确认补植', '取消待办']
const patrolActions = ['开始巡护', '确认完成', '取消任务']

const allBreaks = ref<BatchBreakRow[]>([])
const batches = ref<EntryRow[]>([])
const replantTodos = ref<EntryRow[]>([])
const recheckPatrols = ref<EntryRow[]>([])

const selectedRegions = ref<string[]>([])
const selectedStatuses = ref<string[]>([])
const selectedIds = ref<number[]>([])
const simulateFailure = ref(false)
const submitting = ref(false)
const tab = ref<'todo' | 'recheck'>('todo')
const feedback = ref<{ type: 'ok' | 'err' | 'info'; text: string } | null>(null)

const regionOptions = computed(() => [
  ...new Set(allBreaks.value.map((row) => String(row['所属林区'] ?? '')).filter(Boolean)),
])

const filteredBreaks = computed(() =>
  allBreaks.value.filter((row) => {
    const regionHit = selectedRegions.value.length === 0
      || selectedRegions.value.includes(String(row['所属林区'] ?? ''))
    const statusHit = selectedStatuses.value.length === 0
      || selectedStatuses.value.includes(String(row.status))
    return regionHit && statusHit
  }),
)

const selectedRows = computed(() =>
  allBreaks.value.filter((row) => selectedIds.value.includes(Number(row.id))),
)
const selectedRegion = computed(() =>
  selectedRows.value.length ? String(selectedRows.value[0]['所属林区'] ?? '') : null,
)
const selectedFarm = computed(() =>
  selectedRows.value.length ? String(selectedRows.value[0]['所属林场'] ?? '') : '—',
)
const selectedTotalWidth = computed(() =>
  selectedRows.value.reduce((sum, row) => sum + (Number(row['带宽米数']) || 0), 0),
)
const canSubmit = computed(() => selectedRows.value.length > 0)
const openBatchCount = computed(() =>
  batches.value.filter((row) => ['待作业', '作业中'].includes(String(row.status))).length,
)

const filteredSelectable = computed(() =>
  filteredBreaks.value.filter((row) => isSelectable(row)),
)
const allFilteredSelected = computed(() =>
  filteredSelectable.value.length > 0
  && filteredSelectable.value.every((row) => selectedIds.value.includes(Number(row.id))),
)

function isSelectable(row: BatchBreakRow): boolean {
  // 同批只能来自同一林场：已有勾选时，只放行同林区隔离带。
  return selectedRegion.value === null || selectedRegion.value === String(row['所属林区'] ?? '')
}

function toggleInList(list: string[], value: string) {
  const index = list.indexOf(value)
  if (index >= 0) {
    list.splice(index, 1)
  } else {
    list.push(value)
  }
}

function toggleRegion(region: string) {
  toggleInList(selectedRegions.value, region)
}

function toggleStatus(status: string) {
  toggleInList(selectedStatuses.value, status)
}

function clearFilters() {
  selectedRegions.value = []
  selectedStatuses.value = []
}

function toggleRow(row: BatchBreakRow) {
  feedback.value = null
  const id = Number(row.id)
  const index = selectedIds.value.indexOf(id)
  if (index >= 0) {
    selectedIds.value.splice(index, 1)
    return
  }
  if (!isSelectable(row)) {
    feedback.value = {
      type: 'err',
      text: `同批只能来自同一林场：本批已选定${selectedRegion.value}，不能再加入${String(row['所属林区'] ?? '')}的隔离带`,
    }
    return
  }
  selectedIds.value.push(id)
}

function toggleSelectAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  if (checked) {
    // 全选也要守同一林场口径：尚未勾选且筛选结果横跨多林区时，只全选首个林区。
    let candidates = filteredSelectable.value
    if (selectedRegion.value === null) {
      const firstRegion = String(candidates[0]?.['所属林区'] ?? '')
      if (firstRegion && candidates.some((row) => String(row['所属林区']) !== firstRegion)) {
        candidates = candidates.filter((row) => String(row['所属林区']) === firstRegion)
        feedback.value = {
          type: 'info',
          text: `同批只能来自同一林场，已只全选${firstRegion}的隔离带；其他林区请另开一批。`,
        }
      }
    }
    const merged = new Set(selectedIds.value)
    candidates.forEach((row) => merged.add(Number(row.id)))
    selectedIds.value = [...merged]
  } else {
    const removable = new Set(filteredSelectable.value.map((row) => Number(row.id)))
    selectedIds.value = selectedIds.value.filter((id) => !removable.has(id))
    feedback.value = null
  }
}

function reload() {
  allBreaks.value = listBatchBreaks()
  batches.value = listBatches()
  replantTodos.value = listReplantTodos()
  recheckPatrols.value = listRecheckPatrols()
}

async function submitBatch(kind: MaintenanceKind) {
  if (!canSubmit.value || submitting.value) {
    return
  }
  submitting.value = true
  feedback.value = null
  try {
    const result = createMaintenanceBatch({
      kind,
      breakIds: [...selectedIds.value],
      simulateFailure: simulateFailure.value,
    })
    reload()
    if (result.ok) {
      feedback.value = { type: result.duplicated ? 'info' : 'ok', text: result.message }
      if (!result.duplicated) {
        selectedIds.value = []
        tab.value = kind === '补植' ? 'todo' : 'recheck'
      }
    } else {
      feedback.value = { type: 'err', text: result.message }
    }
  } finally {
    submitting.value = false
  }
}

function applyBatchAction(action: string, row: EntryRow) {
  const result = runAction('firebreakbatch', Number(row.id), action)
  reload()
  feedback.value = { type: result.ok ? 'ok' : 'err', text: result.message }
}

function applyTodoAction(action: string, row: EntryRow) {
  const result = runAction('firebelttodo', Number(row.id), action)
  reload()
  feedback.value = { type: result.ok ? 'ok' : 'err', text: result.message }
}

function applyPatrolAction(action: string, row: EntryRow) {
  const result = runAction('patrol', Number(row.id), action)
  reload()
  feedback.value = { type: result.ok ? 'ok' : 'err', text: result.message }
}

function exportBatches() {
  downloadEntries('firebreakbatch')
}

onMounted(reload)
</script>

<style scoped>
.filter-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.filter-group { display: flex; flex-direction: column; gap: 6px; }
.filter-label { font-size: 12px; color: var(--muted); }
.drill-row { flex-direction: row; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.drill-check { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  border: 1px solid var(--border);
  background: #f6f8fb;
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 12px;
  cursor: pointer;
}
.chip.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.batch-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  background: #eef4ff;
  border: 1px solid #c7dbff;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.batch-summary { display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; }
.batch-summary .muted { color: var(--muted); }
.batch-actions { display: flex; gap: 8px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.feedback { font-size: 13px; margin: 0 0 10px; padding: 6px 10px; border-radius: 6px; }
.feedback.ok { background: #ecfdf3; color: #027a48; }
.feedback.err { background: #fef3f2; color: #b42318; }
.feedback.info { background: #fffaeb; color: #b54708; }
.pick-col { width: 36px; text-align: center; }
.pick-table tr.picked { background: #f5f9ff; }
.tag {
  display: inline-block;
  font-size: 11px;
  border-radius: 4px;
  padding: 0 6px;
  margin-left: 4px;
}
.tag.warn { background: #fffaeb; color: #b54708; }
.pick-hint { font-size: 12px; color: var(--muted); margin: 6px 0 16px; }
.section-title { font-size: 15px; margin: 18px 0 8px; }
.sub-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.sub-head .section-title { margin-bottom: 8px; }
.tab-row { display: flex; gap: 6px; }
.tab {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px 6px 0 0;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.tab.active { background: var(--brand); border-color: var(--brand); color: #fff; }
</style>
