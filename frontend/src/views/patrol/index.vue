<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>巡护任务管理</h2>
        <p class="page-desc">维护巡护任务，围绕任务编号、巡护区域、巡护路线、巡护员做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡护任务</button>
        <button class="btn" type="button" @click="exportRows">导出巡护任务清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无巡护任务数据，可先登记巡护任务</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡护任务记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <h3 class="section-title">巡护路线复查事项（隔离带维护批次联动生成）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>复查编号</th>
          <th>巡护区域</th>
          <th>巡护路线</th>
          <th>复查内容</th>
          <th>计划日期</th>
          <th>复查状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in reviewRows" :key="String(row.id)">
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
        <tr v-if="!reviewRows.length">
          <td colspan="7" class="empty-state">暂无复查事项，维护批次落库后按林区路线自动安排</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { REVIEW_KEY, completeReview } from '@/api/maintenance-batch'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ["任务编号", "巡护区域", "巡护路线", "巡护员", "巡护日期", "巡护时段", "发现火情数", "任务状态"]
const actions = ["开始巡护", "确认完成", "取消任务"]
const statuses = ["待执行", "执行中", "已完成", "已取消"]
const stats = [{"label": "今日任务数", "value": 0}, {"label": "已完成任务", "value": 0}, {"label": "巡护覆盖率", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡护任务登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡护任务列表读取失败'
  }
  reviewRows.value = listRows(REVIEW_KEY)
}

const reviewRows = ref<EntryRow[]>([])

function finishReview(id: number) {
  errorMessage.value = ''
  const result = completeReview(id)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

onMounted(reload)
</script>
