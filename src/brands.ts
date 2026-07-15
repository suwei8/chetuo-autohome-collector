/**
 * brands.csv 解析工具。
 *
 * swoiow/autohome 的 brands.csv 格式：
 *   0,1,2
 *   车系名 (数量),series_XXXX,https://car.autohome.com.cn/price/series-XXXX.html
 *   车系名 (停售) (数量),series_XXXX,https://...
 *
 * 我们只需要 series_XXXX 中的数字 ID 和车系名。
 */

import { readFileSync } from 'fs';

export interface BrandSeriesEntry {
  /** 车系名（去掉括号部分） */
  name: string;
  /** 汽车之家车系 ID（series_18 → 18） */
  seriesId: number;
  /** 原始名称（含数量/停售标记） */
  rawName: string;
  /** 是否停售 */
  stopped: boolean;
  /** 汽车之家 URL */
  url: string;
}

/**
 * 从 brands.csv 文件解析车系列表。
 *
 * 文件格式（UTF-8 BOM）：
 *   第一行是表头 "0,1,2"
 *   后续每行：车系名(数量),series_XXXX,URL
 */
export function parseBrandsCsv(filePath: string): BrandSeriesEntry[] {
  const raw = readFileSync(filePath, 'utf-8');
  // 去 BOM
  const content = raw.replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());

  const entries: BrandSeriesEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    // CSV 可能含逗号在引号内，但 swoiow 的 brands.csv 格式简单
    // 格式：name,series_XXXX,url
    // name 本身不含逗号（车系名是纯文本）
    const parts = lines[i].split(',');
    if (parts.length < 2) continue;

    const rawName = parts[0].trim();
    const seriesKey = parts[1].trim();
    const url = parts.slice(2).join(',').trim();

    const idMatch = /series_(\d+)/.exec(seriesKey);
    if (!idMatch) continue;

    const seriesId = Number(idMatch[1]);
    const stopped = rawName.includes('停售');
    // 去掉括号部分：问界M5 (19) → 问界M5, 奥迪A4 (停售) (45) → 奥迪A4
    const name = rawName.replace(/\s*\(.*?\)\s*/g, '').trim();

    entries.push({ name, seriesId, rawName, stopped, url });
  }

  return entries;
}
