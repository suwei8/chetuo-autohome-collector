/**
 * 采集器主入口（极简版）。
 *
 * 只采集：品牌、车系、车型名称、年份、排量。
 * 输出单一 CSV：output/car_models.csv
 *
 * 流程：
 *   1. 下载 swoiow/autohome 的 brands.csv 作为车系 ID 清单
 *   2. 对每个车系：
 *      a. 抓车系页 /price/series-{id}.html → 提取 spec ID 列表
 *      b. 抓第一个 spec 的参数页 → 解析全部车型名称 + 排量
 *   3. 输出 output/car_models.csv（品牌,车系,specId,车型名称,年份,排量L）
 *
 * 用法：
 *   pnpm collect              # 全量
 *   pnpm collect:small        # 前 5 个
 *   pnpm collect --limit=10
 *   pnpm collect --only=18,3170
 *   pnpm collect --skip-stopped
 *   pnpm collect --resume     # 断点续传
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import {
  fetchSeriesPage,
  fetchSpecPage,
  extractSpecIds,
  parseModels,
  sleep,
  type CarModel,
} from './autohome.js';
import { parseBrandsCsv, type BrandSeriesEntry } from './brands.js';

// ─── 配置 ─────────────────────────────────────────────

const OUTPUT_DIR = 'output';
const CSV_FILE = join(OUTPUT_DIR, 'car_models.csv');
const PROGRESS_FILE = join(OUTPUT_DIR, 'progress.json');
const BRANDS_CSV_URL =
  'https://raw.githubusercontent.com/swoiow/autohome/main/brands.csv';
const REQUEST_DELAY_MS = 2000;
const JITTER_MS = 1500;

// ─── 参数解析 ──────────────────────────────────────────

interface CliArgs {
  limit: number | null;
  only: number[] | null;
  skipStopped: boolean;
  resume: boolean;
  shard: { index: number; total: number } | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const opts: CliArgs = { limit: null, only: null, skipStopped: false, resume: false, shard: null };
  for (const arg of args) {
    if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice(8));
    else if (arg.startsWith('--only=')) opts.only = arg.slice(7).split(',').map(Number);
    else if (arg === '--skip-stopped') opts.skipStopped = true;
    else if (arg === '--resume') opts.resume = true;
    else if (arg.startsWith('--shard=')) {
      const [idx, total] = arg.slice(8).split('/').map(Number);
      opts.shard = { index: idx, total };
    }
  }
  return opts;
}

// ─── 进度管理 ─────────────────────────────────────────

interface Progress {
  completed: number[];
  failed: Array<{ seriesId: number; error: string }>;
  lastUpdated: string;
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE))
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
  return { completed: [], failed: [], lastUpdated: new Date().toISOString() };
}

function saveProgress(p: Progress): void {
  p.lastUpdated = new Date().toISOString();
  writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

// ─── CSV 输出 ─────────────────────────────────────────

function csvEscape(val: string): string {
  if (!val) return '';
  if (/[",\n\r]/.test(val)) return `"${val.replace(/"/g, '""')}"`;
  return val;
}

function initCsv(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!existsSync(CSV_FILE)) {
    writeFileSync(CSV_FILE, '品牌,车系,specId,车型名称,年份,排量L\n', 'utf-8');
  }
}

function appendModels(models: CarModel[]): void {
  const lines = models
    .map((m) =>
      [m.brand, m.series, String(m.specId), m.modelName, m.year, m.displacement]
        .map(csvEscape)
        .join(','),
    )
    .join('\n');
  appendFileSync(CSV_FILE, lines + '\n', 'utf-8');
}

// ─── 下载 brands.csv ──────────────────────────────────

async function downloadBrandsCsv(): Promise<string> {
  const path = join(OUTPUT_DIR, 'brands.csv');
  mkdirSync(OUTPUT_DIR, { recursive: true });
  if (existsSync(path)) {
    console.log('[brands.csv] 已存在，跳过下载');
    return path;
  }
  console.log('[brands.csv] 下载中...');
  const resp = await fetch(BRANDS_CSV_URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  writeFileSync(path, text, 'utf-8');
  console.log(`[brands.csv] ${text.split('\n').length} 行`);
  return path;
}

// ─── 采集单个车系 ─────────────────────────────────────

interface SeriesResult {
  seriesId: number;
  seriesName: string;
  modelCount: number;
  status: 'ok' | 'no_specs' | 'no_config' | 'error';
  error?: string;
}

async function collectSeries(
  entry: BrandSeriesEntry,
  index: number,
  total: number,
): Promise<SeriesResult> {
  const { seriesId, name, stopped } = entry;
  const label = `[${index + 1}/${total}] series-${seriesId} ${name}${stopped ? ' (停售)' : ''}`;

  console.log(`${label} → 抓取车系页...`);

  // Step 1: 车系页 → spec IDs
  let specIds: number[];
  try {
    const html = await fetchSeriesPage(seriesId);
    specIds = extractSpecIds(html);
    await sleep(REQUEST_DELAY_MS + Math.random() * JITTER_MS);
  } catch (err: any) {
    console.error(`${label} → 车系页失败: ${err.message}`);
    return { seriesId, seriesName: name, modelCount: 0, status: 'error', error: err.message };
  }

  if (specIds.length === 0) {
    console.warn(`${label} → 无 spec ID`);
    return { seriesId, seriesName: name, modelCount: 0, status: 'no_specs' };
  }

  // Step 2: 参数页 → 车型列表
  try {
    const specHtml = await fetchSpecPage(specIds[0]);
    const models = parseModels(specHtml, name);
    await sleep(REQUEST_DELAY_MS + Math.random() * JITTER_MS);

    if (models.length === 0) {
      console.warn(`${label} → 未解析到车型`);
      return { seriesId, seriesName: name, modelCount: 0, status: 'no_config' };
    }

    appendModels(models);
    console.log(`${label} → ${models.length} 车型 (品牌: ${models[0].brand})`);
    return { seriesId, seriesName: name, modelCount: models.length, status: 'ok' };
  } catch (err: any) {
    console.error(`${label} → 参数页失败: ${err.message}`);
    return { seriesId, seriesName: name, modelCount: 0, status: 'error', error: err.message };
  }
}

// ─── 主流程 ───────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  console.log('=== 汽车之家车型库采集器（极简版）===');
  console.log(`limit=${args.limit ?? '无'} only=${args.only ?? '无'} skipStopped=${args.skipStopped} resume=${args.resume} shard=${args.shard ? `${args.shard.index}/${args.shard.total}` : '无'}`);
  console.log();

  const brandsPath = await downloadBrandsCsv();
  const allEntries = parseBrandsCsv(brandsPath);
  console.log(`brands.csv: ${allEntries.length} 个车系`);

  let entries = allEntries;
  if (args.only) {
    const s = new Set(args.only);
    entries = entries.filter((e) => s.has(e.seriesId));
  }
  if (args.skipStopped) entries = entries.filter((e) => !e.stopped);
  if (args.shard) {
    // 分片：按 seriesId 取模分配
    entries = entries.filter((e) => e.seriesId % args.shard!.total === args.shard!.index);
  }
  if (args.limit !== null) entries = entries.slice(0, args.limit);

  console.log(`筛选后: ${entries.length} 个车系\n`);

  const progress = args.resume ? loadProgress() : { completed: [], failed: [], lastUpdated: '' };
  const done = new Set(progress.completed);

  initCsv();

  let ok = 0, fail = 0, skip = 0, totalModels = 0;

  for (let i = 0; i < entries.length; i++) {
    if (done.has(entries[i].seriesId)) { skip++; continue; }

    const r = await collectSeries(entries[i], i, entries.length);
    if (r.status === 'ok') { ok++; totalModels += r.modelCount; progress.completed.push(r.seriesId); }
    else if (r.status === 'error') { fail++; progress.failed.push({ seriesId: r.seriesId, error: r.error ?? '' }); }
    else { progress.completed.push(r.seriesId); } // no_specs/no_config 也算完成

    if ((ok + fail) % 10 === 0) saveProgress(progress);
  }

  saveProgress(progress);

  console.log(`\n=== 完成 ===`);
  console.log(`成功: ${ok}, 失败: ${fail}, 跳过: ${skip}, 总车型: ${totalModels}`);
  console.log(`CSV: ${CSV_FILE}`);
}

main().catch((err) => { console.error('异常:', err); process.exit(1); });
