<template>
  <section class="page" data-module="maintenancebatch">
    <header class="page-head">
      <div>
        <h2>防火隔离带维护批次台</h2>
        <p class="page-desc">
          按所属林区和维护状态多选隔离带，整组安排割草或补植；同批只能来自同一林场，
          缺失最近维护日期的旧带按建成日期回填。批次落库同时更新隔离带状态、防火林带补植清单与巡护路线复查事项。
        </p>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">已选隔离带</span>
        <strong class="stat-value">{{ selected.length }} 条</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">带宽合计</span>
        <strong class="stat-value">{{ totalWidth }} 米</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">锁定林场</span>
        <strong class="stat-value">{{ lockFarm || '未锁定' }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">历史批次</span>
        <strong class="stat-value">{{ batches.length }} 批</strong>
      </article>
    </div>

    <div class="filter-panel">
      <div class="multi-filter">
        <span class="multi-filter-label">所属林区（多选）</span>
        <label v-for="region in regionOptions" :key="region" class="check-pill">
          <input v-model="regionFilter" type="checkbox" :value="region" />
          {{ region }}
        </label>
      </div>
      <div class="multi-filter">
        <span class="multi-filter-label">维护状态（多选）</span>
        <label v-for="status in statusOptions" :key="status" class="check-pill">
          <input v-model="statusFilter" type="checkbox" :value="status" />
          {{ status }}
        </label>
      </div>
      <button class="btn ghost" type="button" @click="resetSelection">清空筛选与选择</button>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th class="col-check">选择</th>
          <th>隔离带编号</th>
          <th>所属林场</th>
          <th>所属林区</th>
          <th>带宽米数</th>
          <th>维护状态</th>
          <th>维护基准日</th>
          <th>距上次维护</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="candidate in filteredCandidates" :key="candidate.id" :class="{ 'row-disabled': !canPick(candidate) }">
          <td>
            <input
              type="checkbox"
              :checked="isPicked(candidate.id)"
              :disabled="!canPick(candidate)"
              @change="togglePick(candidate.id)"
            />
          </td>
          <td>{{ candidate.code }}</td>
          <td>{{ candidate.farm }}</td>
          <td>{{ candidate.region }}</td>
          <td>{{ candidate.width }} 米</td>
          <td>{{ candidate.status }}</td>
          <td>
            {{ candidate.baseDate }}
            <span v-if="candidate.backfilled" class="tag tag-warn" title="缺失最近维护日期，按建成日期回填">建成回填</span>
          </td>
          <td>{{ candidate.intervalDays }} 天</td>
        </tr>
        <tr v-if="!filteredCandidates.length">
          <td colspan="8" class="empty-state">当前筛选条件下没有可选的防火隔离带</td>
        </tr>
      </tbody>
    </table>

    <div class="batch-console">
      <div class="console-hint">
        <template v-if="lockFarm">本批已锁定「{{ lockFarm }}」，其他林场的隔离带暂不可选；林区可跨。</template>
        <template v-else>勾选第一条隔离带后按其所属林场锁定本批。</template>
      </div>
      <label class="fail-switch">
        故障演练
        <select v-model="failPoint">
          <option value="">不注入故障</option>
          <option value="replant">补植清单写入失败</option>
          <option value="review">复查事项写入失败</option>
        </select>
      </label>
      <button class="btn primary" type="button" :disabled="!selected.length" @click="submit('割草')">
        整组安排割草
      </button>
      <button class="btn primary" type="button" :disabled="!selected.length" @click="submit('补植')">
        整组安排补植
      </button>
    </div>

    <p v-if="message" class="batch-message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</p>

    <h3 class="section-title">维护批次记录</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>批次编号</th>
          <th>所属林场</th>
          <th>作业方式</th>
          <th>隔离带条数</th>
          <th>带宽合计米数</th>
          <th>涉及林区</th>
          <th>安排日期</th>
          <th>联动生成（补植清单/林带待办/路线复查）</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="batch in batches" :key="String(batch.id)" :class="{ 'row-void': String(batch.status) === '已废弃' }">
          <td>
            <button class="link" type="button" @click="toggleExpand(Number(batch.id))">{{ batch['批次编号'] }}</button>
          </td>
          <td>{{ batch['所属林场'] }}</td>
          <td>{{ batch['作业方式'] }}</td>
          <td>{{ batch['隔离带条数'] }}</td>
          <td>{{ batch['带宽合计米数'] }}</td>
          <td>{{ batch['涉及林区'] }}</td>
          <td>{{ batch['安排日期'] }}</td>
          <td>{{ batch['补植清单数'] }} / {{ batch['林带待办数'] }} / {{ batch['复查事项数'] }}</td>
          <td>{{ batch.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="voidOne(Number(batch.id))">作废批次</button>
          </td>
        </tr>
        <tr v-if="!batches.length">
          <td colspan="10" class="empty-state">还没有维护批次，先在上方勾选隔离带成组安排</td>
        </tr>
      </tbody>
    </table>

    <div v-if="expanded" class="batch-detail">
      <h4 class="detail-title">{{ expanded['批次编号'] }} 联动资料（按批次指纹追溯）</h4>
      <div class="detail-grid">
        <div>
          <h5>防火林带补植清单</h5>
          <table class="data-table sub-table">
            <thead>
              <tr><th>清单编号</th><th>林区</th><th>林带</th><th>来源隔离带</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in replantOf(expanded)" :key="String(row.id)">
                <td>{{ row['清单编号'] }}</td>
                <td>{{ row['所属林区'] }}</td>
                <td>{{ row['林带名称'] }}</td>
                <td>{{ row['来源隔离带'] }}</td>
                <td>{{ row.status }}</td>
              </tr>
              <tr v-if="!replantOf(expanded).length"><td colspan="5" class="empty-state">割草批次不生成补植清单</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h5>防火林带待办（补植任务）</h5>
          <table class="data-table sub-table">
            <thead>
              <tr><th>待办编号</th><th>任务名称</th><th>关联清单</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in todosOf(expanded)" :key="String(row.id)">
                <td>{{ row['待办编号'] }}</td>
                <td>{{ row['任务名称'] }}</td>
                <td>{{ row['关联清单'] }}</td>
                <td>{{ row.status }}</td>
                <td>
                  <button
                    v-if="String(row.status) !== '已完成'"
                    class="link"
                    type="button"
                    @click="finishTodo(Number(row.id))"
                  >
                    完成补植
                  </button>
                  <span v-else>—</span>
                </td>
              </tr>
              <tr v-if="!todosOf(expanded).length"><td colspan="5" class="empty-state">割草批次不生成补植任务</td></tr>
            </tbody>
          </table>
        </div>
        <div class="detail-span">
          <h5>巡护路线复查事项</h5>
          <table class="data-table sub-table">
            <thead>
              <tr><th>复查编号</th><th>巡护区域</th><th>巡护路线</th><th>复查内容</th><th>计划日期</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in reviewsOf(expanded)" :key="String(row.id)">
                <td>{{ row['复查编号'] }}</td>
                <td>{{ row['巡护区域'] }}</td>
                <td>{{ row['巡护路线'] }}</td>
                <td>{{ row['复查内容'] }}</td>
                <td>{{ row['计划日期'] }}</td>
                <td>{{ row.status }}</td>
                <td>
                  <button
                    v-if="String(row.status) !== '已复查'"
                    class="link"
                    type="button"
                    @click="finishReview(Number(row.id))"
                  >
                    确认复查
                  </button>
                  <span v-else>—</span>
                </td>
              </tr>
              <tr v-if="!reviewsOf(expanded).length"><td colspan="7" class="empty-state">无复查事项</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  BATCH_KEY,
  FIREBELT_TODO_KEY,
  REPLANT_KEY,
  REVIEW_KEY,
  completeFirebeltTodo,
  completeReview,
  createBatch,
  listCandidates,
  voidBatch,
  type BatchOperation,
  type BreakCandidate,
  type FailPoint,
} from '@/api/maintenance-batch'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const statusOptions = ['正常', '需割草', '需补植', '已荒废']

const candidates = ref<BreakCandidate[]>([])
const batches = ref<EntryRow[]>([])
const replantRows = ref<EntryRow[]>([])
const todoRows = ref<EntryRow[]>([])
const reviewRows = ref<EntryRow[]>([])
const pickedIds = ref<number[]>([])
const regionFilter = ref<string[]>([])
const statusFilter = ref<string[]>([])
const failPoint = ref<FailPoint>('')
const message = ref('')
const messageOk = ref(false)
const expandedId = ref<number | null>(null)

const regionOptions = computed(() => [...new Set(candidates.value.map((item) => item.region))].sort())

const filteredCandidates = computed(() =>
  candidates.value.filter((item) => {
    const regionOk = regionFilter.value.length === 0 || regionFilter.value.includes(item.region)
    const statusOk = statusFilter.value.length === 0 || statusFilter.value.includes(item.status)
    return regionOk && statusOk
  }),
)

const selected = computed(() =>
  pickedIds.value
    .map((id) => candidates.value.find((item) => item.id === id))
    .filter((item): item is BreakCandidate => Boolean(item)),
)
const lockFarm = computed(() => (selected.value.length ? selected.value[0].farm : ''))
const totalWidth = computed(() => selected.value.reduce((sum, item) => sum + item.width, 0))
const expanded = computed(() => batches.value.find((row) => Number(row.id) === expandedId.value) ?? null)

function reload() {
  candidates.value = listCandidates()
  batches.value = [...listRows(BATCH_KEY)].sort((a, b) => Number(b.id) - Number(a.id))
  replantRows.value = listRows(REPLANT_KEY)
  todoRows.value = listRows(FIREBELT_TODO_KEY)
  reviewRows.value = listRows(REVIEW_KEY)
  // 已不存在或跨林场的残留勾选直接清掉。
  pickedIds.value = pickedIds.value.filter((id) => {
    const candidate = candidates.value.find((item) => item.id === id)
    if (!candidate) {
      return false
    }
    return !lockFarm.value || candidate.farm === lockFarm.value
  })
}

function isPicked(id: number): boolean {
  return pickedIds.value.includes(id)
}

function canPick(candidate: BreakCandidate): boolean {
  return !lockFarm.value || isPicked(candidate.id) || candidate.farm === lockFarm.value
}

function togglePick(id: number) {
  message.value = ''
  if (isPicked(id)) {
    pickedIds.value = pickedIds.value.filter((value) => value !== id)
    return
  }
  pickedIds.value = [...pickedIds.value, id]
}

function resetSelection() {
  regionFilter.value = []
  statusFilter.value = []
  pickedIds.value = []
  message.value = ''
}

function submit(operation: BatchOperation) {
  const result = createBatch({ breakIds: [...pickedIds.value], operation, failPoint: failPoint.value })
  messageOk.value = result.ok
  message.value = result.message
  if (!result.ok) {
    return
  }
  pickedIds.value = []
  reload()
}

function voidOne(id: number) {
  const result = voidBatch(id)
  messageOk.value = result.ok
  message.value = result.message
  reload()
}

function toggleExpand(id: number) {
  expandedId.value = expandedId.value === id ? null : id
}

function byFingerprint(batch: EntryRow, rows: EntryRow[]): EntryRow[] {
  const fingerprint = String(batch['指纹'] ?? '')
  return rows.filter((row) => String(row['指纹'] ?? '') === fingerprint)
}
function replantOf(batch: EntryRow): EntryRow[] {
  return byFingerprint(batch, replantRows.value)
}
function todosOf(batch: EntryRow): EntryRow[] {
  return byFingerprint(batch, todoRows.value)
}
function reviewsOf(batch: EntryRow): EntryRow[] {
  return byFingerprint(batch, reviewRows.value)
}

function finishTodo(id: number) {
  const result = completeFirebeltTodo(id)
  messageOk.value = result.ok
  message.value = result.message
  reload()
}

function finishReview(id: number) {
  const result = completeReview(id)
  messageOk.value = result.ok
  message.value = result.message
  reload()
}

reload()
</script>
