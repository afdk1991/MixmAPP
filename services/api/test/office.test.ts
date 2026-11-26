// 办公管理领域模块测试：
// 覆盖任务看板四态流转、审核通过与驳回（原因必须落到 payload.reviewNote）、
// 会议纪要台账幂等、清单完成率写入进度，以及领域指标（待审核 / 本周完成 / 平均办理时长）。
// 这里直接驱动领域模块：验的是业务语义，HTTP 路由层由集成方覆盖。

import { beforeEach, describe, expect, it } from 'vitest';
import { IdFactory } from '@mixmapp/ids';
import { MemoryStore } from '../src/db/memory.js';
import { officeModule } from '../src/modules/domains/office.js';
import { testConfig } from './helpers.js';

const USER = 'u-office-1';
const DAY = 86_400_000;

let store: MemoryStore;
let ids: IdFactory;

function ctx() {
  return { userId: USER, store, config: testConfig, ids };
}

/** 建一条任务并推进到指定阶段（todo → doing → review）。 */
async function taskAt(stage: 'todo' | 'doing' | 'review'): Promise<string> {
  const created = await officeModule.act({
    ...ctx(),
    input: { action: 'create', note: '整理季度台账', payload: { owner: '张三', deadline: '2026-12-01' } },
  });
  const id = created.item!.id;
  if (stage === 'todo') return id;
  await officeModule.act({ ...ctx(), input: { action: 'advance', entryId: id } });
  if (stage === 'doing') return id;
  await officeModule.act({ ...ctx(), input: { action: 'advance', entryId: id } });
  return id;
}

beforeEach(() => {
  store = new MemoryStore();
  ids = new IdFactory({ workerId: 7 });
});

describe('办公管理领域模块', () => {
  it('list 补齐负责人 / 期限 / 审核状态', async () => {
    await taskAt('todo');
    const items = await officeModule.list(ctx());
    expect(items).toHaveLength(1);
    const meta = Object.fromEntries(items[0]!.meta.map((m) => [m.label, m.value]));
    expect(meta['负责人']).toBe('张三');
    expect(meta['期限']).toBe('2026-12-01');
    expect(meta['审核状态']).toBe('未提交');
  });

  it('advance 按待处理 → 办理中 → 待审核推进', async () => {
    const id = await taskAt('review');
    const items = await officeModule.list(ctx());
    expect(items[0]!.stage).toBe('review');
    expect(items[0]!.stageLabel).toBe('待审核');
    const rejected = await officeModule.act({
      ...ctx(),
      input: { action: 'review', entryId: id, payload: { decision: 'approve' } },
    });
    expect(rejected.ok).toBe(true);
  });

  it('审核通过进入已完成，重复提交不重复记账', async () => {
    const id = await taskAt('review');
    const approved = await officeModule.act({
      ...ctx(),
      input: { action: 'review', entryId: id, payload: { decision: 'approve' } },
    });
    expect(approved.ok).toBe(true);
    expect(approved.changed).toBe(true);
    expect(approved.item!.stage).toBe('done');
    expect(approved.item!.payload['reviewResult']).toBe('approved');

    const again = await officeModule.act({
      ...ctx(),
      input: { action: 'review', entryId: id, payload: { decision: 'approve' } },
    });
    expect(again.ok).toBe(true);
    expect(again.changed).toBe(false);
  });

  it('驳回必须写明原因，原因落到 payload.reviewNote，条目退回办理中', async () => {
    const id = await taskAt('review');

    const withoutNote = await officeModule.act({
      ...ctx(),
      input: { action: 'review', entryId: id, payload: { decision: 'reject' } },
    });
    expect(withoutNote.ok).toBe(false);
    expect(withoutNote.changed).toBe(false);
    expect(withoutNote.message).not.toBe('');

    const rejected = await officeModule.act({
      ...ctx(),
      input: { action: 'review', entryId: id, payload: { decision: 'reject', reviewNote: '附件缺少签批页' } },
    });
    expect(rejected.ok).toBe(true);
    expect(rejected.changed).toBe(true);
    expect(rejected.item!.stage).toBe('doing');
    expect(rejected.item!.payload['reviewNote']).toBe('附件缺少签批页');
    expect(rejected.item!.payload['reviewResult']).toBe('rejected');

    const again = await officeModule.act({
      ...ctx(),
      input: { action: 'review', entryId: id, payload: { decision: 'reject', reviewNote: '附件缺少签批页' } },
    });
    expect(again.changed).toBe(false);
  });

  it('不是待审核阶段的条目不能审核', async () => {
    const id = await taskAt('doing');
    const result = await officeModule.act({
      ...ctx(),
      input: { action: 'review', entryId: id, payload: { decision: 'approve' } },
    });
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.message).toContain('待审核');
  });

  it('会议纪要记入台账，重复提交不重复记账', async () => {
    const input = {
      action: 'meeting_note',
      payload: {
        title: '产品周例会',
        participants: ['张三', '李四'],
        decisions: ['下周三前上线灰度', '补齐埋点文档'],
      },
    };
    const first = await officeModule.act({ ...ctx(), input });
    expect(first.ok).toBe(true);
    expect(first.changed).toBe(true);
    expect(first.message).toContain('产品周例会');
    expect(first.message).toContain('决议 2 条');

    const events = await store.suite.events.listByUser(USER, { domainId: 'office', kind: 'meeting-note' });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload['participantCount']).toBe(2);
    expect(events[0]!.payload['decisionCount']).toBe(2);

    const second = await officeModule.act({ ...ctx(), input });
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
    expect(await store.suite.events.listByUser(USER, { domainId: 'office', kind: 'meeting-note' })).toHaveLength(1);
  });

  it('会议纪要缺标题时拒绝写入', async () => {
    const result = await officeModule.act({ ...ctx(), input: { action: 'meeting_note', payload: {} } });
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(await store.suite.events.listByUser(USER, { domainId: 'office', kind: 'meeting-note' })).toHaveLength(0);
  });

  it('清单完成率写入进度，状态按完成率自动取', async () => {
    const checklist = ['整理发票', '归档合同', '回复邮件'];
    const partial = await officeModule.act({
      ...ctx(),
      input: { action: 'checklist_progress', entryId: 'office-task-board', payload: { checklist, checked: 2 } },
    });
    expect(partial.ok).toBe(true);
    expect(partial.changed).toBe(true);
    const row = await store.suite.progress.find(USER, 'office', 'office-task-board');
    expect(row!.status).toBe('doing');
    expect(row!.value).toBe(67);

    const same = await officeModule.act({
      ...ctx(),
      input: { action: 'checklist_progress', entryId: 'office-task-board', payload: { checklist, checked: 2 } },
    });
    expect(same.changed).toBe(false);

    const full = await officeModule.act({
      ...ctx(),
      input: { action: 'checklist_progress', entryId: 'office-task-board', payload: { checklist, checked: 3 } },
    });
    expect(full.changed).toBe(true);
    const done = await store.suite.progress.find(USER, 'office', 'office-task-board');
    expect(done!.status).toBe('done');
    expect(done!.value).toBe(100);
  });

  it('stats 补齐待审核 / 本周完成 / 平均办理时长', async () => {
    await taskAt('review');
    await store.suite.boards.insert({
      id: 'board-old',
      domainId: 'office',
      userId: USER,
      title: '上周完成的台账',
      stage: 'done',
      priority: 'normal',
      amountFen: 0,
      payload: {},
      dueAt: null,
      createdAt: new Date(Date.now() - 3 * DAY),
      updatedAt: new Date(),
    });

    const metrics = await officeModule.stats(ctx());
    const map = Object.fromEntries(metrics.map((m) => [m.label, m.value]));
    expect(map['待审核']).toBe('1 条');
    expect(map['本周完成']).toBe('1 条');
    expect(map['平均办理时长']).toBe('3.0 天');
  });

  it('没有对应数据时不返回假指标', async () => {
    const metrics = await officeModule.stats(ctx());
    const labels = metrics.map((m) => m.label);
    expect(labels).not.toContain('待审核');
    expect(labels).not.toContain('本周完成');
    expect(labels).not.toContain('平均办理时长');
  });
});
