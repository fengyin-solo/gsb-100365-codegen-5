import { strict as assert } from 'node:assert'

import {
  BATCH_KEY,
  REPLANT_KEY,
  FIREBELT_TODO_KEY,
  REVIEW_KEY,
  createBatch,
  listCandidates,
  voidBatch,
} from '../src/api/maintenance-batch'
import { listRows } from '../src/data/local-store'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

const candidates = listCandidates('2026-10-04')
const byCode = (code: string) => candidates.find((item) => item.code === code)!

// 1. 旧带缺失最近维护日期：按建成日期回填，间隔从建成日算起。
check('旧带按建成日期回填维护基准日并计算间隔', () => {
  const fb4 = byCode('FB-0004')
  assert.equal(fb4.backfilled, true)
  assert.equal(fb4.baseDate, '2016-10-01')
  // 2016-10-01 -> 2026-10-04 = 3655 天（含 2020/2024 两个闰年）
  assert.equal(fb4.intervalDays, 3655)
  const fb1 = byCode('FB-0001')
  assert.equal(fb1.backfilled, false)
  assert.equal(fb1.intervalDays, 336)
})

// 2. 整组割草：隔离带状态/最近维护日期更新 + 路线复查生成，不动林带。
check('整组割草批次三处联动（林带不生成补植清单）', () => {
  const before = listRows('firebreak')
  const result = createBatch({ breakIds: [1, 4], operation: '割草' })
  assert.equal(result.ok, true, result.message)
  const after = listRows('firebreak')
  for (const id of [1, 4]) {
    const row = after.find((r) => Number(r.id) === id)!
    assert.equal(row.status, '正常')
    assert.equal(row['最近维护日期'], '2026-10-04')
  }
  assert.equal(listRows(REPLANT_KEY).length, 0)
  assert.equal(listRows(FIREBELT_TODO_KEY).length, 0)
  const reviews = listRows(REVIEW_KEY)
  // 青岭南坡林区：2 条路线；白沙岗林区：1 条路线
  assert.equal(reviews.length, 3)
  assert.ok(reviews.every((r) => r.status === '待复查'))
  // 未选中的隔离带不受影响
  const untouched = after.find((r) => Number(r.id) === 5)!
  assert.equal(untouched.status, before.find((r) => Number(r.id) === 5)!.status)
})

// 3. 重复提交：同林场+同方式+同集合只形成一批。
check('重复提交同一组只形成一批', () => {
  const again = createBatch({ breakIds: [1, 4], operation: '割草' })
  assert.equal(again.ok, false)
  assert.match(again.message, /重复提交/)
  assert.equal(listRows(BATCH_KEY).length, 1)
})

// 4. 跨林场混选被拒。
check('跨林场混选被拒', () => {
  const result = createBatch({ breakIds: [1, 5], operation: '割草' })
  assert.equal(result.ok, false)
  assert.match(result.message, /同一林场/)
  // 失败批次不落库
  assert.equal(listRows(BATCH_KEY).length, 1)
})

// 5. 补植批次：林带状态转「需补植」+ 补植清单 + 林带待办(补植任务) + 复查事项。
check('整组补植联动林带状态、补植清单与林带待办', () => {
  const result = createBatch({ breakIds: [5, 6], operation: '补植' })
  assert.equal(result.ok, true, result.message)
  // 长冲林区只有 1 条林带，2 条隔离带 -> 2 条清单、2 条待办
  assert.equal(listRows(REPLANT_KEY).length, 2)
  assert.equal(listRows(FIREBELT_TODO_KEY).length, 2)
  const belt3 = listRows('firebelt').find((r) => Number(r.id) === 3)!
  assert.equal(belt3.status, '需补植')
  // 补植复查期限 90 天
  const review = listRows(REVIEW_KEY).find((r) => r['巡护区域'] === '长冲林区')!
  assert.equal(review['计划日期'], '2027-01-02')
  assert.match(String(review['复查内容']), /苗木成活/)
})

// 6. 故障注入：复查事项环节失败，三处一起回退。
check('复查事项写入失败时整组回退', () => {
  const breaksBefore = JSON.stringify(listRows('firebreak'))
  const batchesBefore = listRows(BATCH_KEY).length
  const reviewsBefore = listRows(REVIEW_KEY).length
  const result = createBatch({ breakIds: [7], operation: '割草', failPoint: 'review' })
  assert.equal(result.ok, false)
  assert.match(result.message, /整组回退/)
  assert.equal(JSON.stringify(listRows('firebreak')), breaksBefore)
  assert.equal(listRows(BATCH_KEY).length, batchesBefore)
  assert.equal(listRows(REVIEW_KEY).length, reviewsBefore)
})

// 7. 故障注入：补植清单环节失败，隔离带状态也不能变。
check('补植清单写入失败时整组回退', () => {
  const breaksBefore = JSON.stringify(listRows('firebreak'))
  const beltsBefore = JSON.stringify(listRows('firebelt'))
  const result = createBatch({ breakIds: [2], operation: '补植', failPoint: 'replant' })
  assert.equal(result.ok, false)
  assert.match(result.message, /整组回退/)
  assert.equal(JSON.stringify(listRows('firebreak')), breaksBefore)
  assert.equal(JSON.stringify(listRows('firebelt')), beltsBefore)
  assert.equal(listRows(REPLANT_KEY).length, 2)
})

// 8. 作废批次后同组可重新提交。
check('作废批次后允许重新成批', () => {
  const first = listRows(BATCH_KEY).find(
    (r) => r['作业方式'] === '割草' && r['所属林场'] === '青峰林场',
  )!
  const voided = voidBatch(Number(first.id))
  assert.equal(voided.ok, true)
  // 第 2 步的 [1,4] 割草批次已作废，同组同方式可以再提一批。
  const re = createBatch({ breakIds: [1, 4], operation: '割草' })
  assert.equal(re.ok, true, re.message)
  assert.equal(listRows(BATCH_KEY).filter((r) => String(r.status) !== '已废弃').length, 2)
})

console.log(`\n全部 ${passed} 项检查通过`)
