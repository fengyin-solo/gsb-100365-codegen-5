<template>
  <section class="page" data-module="firebelt">
    <header class="page-head">
      <div>
        <h2>防火林带管理</h2>
        <p class="page-desc">维护防火林带，围绕林带编号、林带名称、所属林区、树种组成做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记防火林带</button>
        <button class="btn" type="button" @click="exportRows">导出防火林带清单</button>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无防火林带数据，可先登记防火林带</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条防火林带记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <h3 class="section-title">防火林带补植清单（维护批次联动生成）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>清单编号</th>
          <th>所属林区</th>
          <th>林带编号</th>
          <th>林带名称</th>
          <th>来源隔离带</th>
          <th>登记日期</th>
          <th>清单状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in replantRows" :key="String(row.id)">
          <td>{{ row['清单编号'] }}</td>
          <td>{{ row['所属林区'] }}</td>
          <td>{{ row['林带编号'] }}</td>
          <td>{{ row['林带名称'] }}</td>
          <td>{{ row['来源隔离带'] }}</td>
          <td>{{ row['登记日期'] }}</td>
          <td>{{ row.status }}</td>
        </tr>
        <tr v-if="!replantRows.length">
          <td colspan="7" class="empty-state">暂无补植清单，在维护批次台安排整组补植后自动生成</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">防火林带待办 · 补植任务</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>待办编号</th>
          <th>任务名称</th>
          <th>所属林区</th>
          <th>关联清单</th>
          <th>来源隔离带</th>
          <th>生成日期</th>
          <th>待办状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in todoRows" :key="String(row.id)">
          <td>{{ row['待办编号'] }}</td>
          <td>{{ row['任务名称'] }}</td>
          <td>{{ row['所属林区'] }}</td>
          <td>{{ row['关联清单'] }}</td>
          <td>{{ row['来源隔离带'] }}</td>
          <td>{{ row['生成日期'] }}</td>
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
        <tr v-if="!todoRows.length">
          <td colspan="8" class="empty-state">暂无林带待办，补植批次落库后跟着生成补植任务</td>
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
import { FIREBELT_TODO_KEY, REPLANT_KEY, completeFirebeltTodo } from '@/api/maintenance-batch'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('firebelt')
const columns = ["林带编号", "林带名称", "所属林区", "树种组成", "林带长度", "林带宽度", "种植年份", "林带状态"]
const actions = ["安排补植", "确认补植", "标记退化"]
const statuses = ["完好", "有缺株", "需补植", "已退化"]
const stats = [{"label": "林带总数", "value": 0}, {"label": "完好条数", "value": 0}, {"label": "缺株条数", "value": 0}]

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
  errorMessage.value = '防火林带登记入口尚未接入审批流'
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
    errorMessage.value = error instanceof Error ? error.message : '防火林带列表读取失败'
  }
  replantRows.value = listRows(REPLANT_KEY)
  todoRows.value = listRows(FIREBELT_TODO_KEY)
}

const replantRows = ref<EntryRow[]>([])
const todoRows = ref<EntryRow[]>([])

function finishTodo(id: number) {
  errorMessage.value = ''
  const result = completeFirebeltTodo(id)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

onMounted(reload)
</script>
