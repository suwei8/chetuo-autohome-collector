/**
 * 汽车之家页面抓取与解析工具（极简版）。
 *
 * 只采集：品牌、车系、车型名称、年份、排量。
 * 不解码反爬 span——车型名称的值去掉 span 后就是正确的。
 *
 * 编码：
 *   - 车系页 /price/series-{id}.html 是 GBK
 *   - 参数页 /config/spec/{id}.html 是 UTF-8
 *   - 停售页 /{id}/sale.html 是 GBK
 *   - 配置页 /config/series/{id}.html 是 UTF-8
 */

import iconv from 'iconv-lite';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  Referer: 'https://www.autohome.com.cn/',
};

/** 带重试的 HTTP GET，返回 Buffer。 */
export async function httpGet(url: string, retries = 3): Promise<Buffer> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(2000 * attempt + Math.random() * 1000);
    }
  }
  throw new Error('unreachable');
}

/** 抓取车系页（GBK）。 */
export async function fetchSeriesPage(seriesId: number): Promise<string> {
  const buf = await httpGet(`https://car.autohome.com.cn/price/series-${seriesId}.html`);
  return iconv.decode(buf, 'gbk');
}

/** 抓取参数页（UTF-8）。 */
export async function fetchSpecPage(specId: number): Promise<string> {
  const buf = await httpGet(`https://car.autohome.com.cn/config/spec/${specId}.html`);
  return buf.toString('utf-8');
}

/** 抓取停售页（GBK）——包含所有停售年款的全部车型列表。 */
export async function fetchSalePage(seriesId: number): Promise<string> {
  const buf = await httpGet(`https://www.autohome.com.cn/${seriesId}/sale.html`);
  return iconv.decode(buf, 'gbk');
}

/** 抓取车系配置页（UTF-8）——包含在售年款的车型列表和参数。 */
export async function fetchConfigSeriesPage(seriesId: number): Promise<string> {
  const buf = await httpGet(`https://car.autohome.com.cn/config/series/${seriesId}.html`);
  return buf.toString('utf-8');
}

/** 从车系页提取 spec ID 列表。 */
export function extractSpecIds(seriesHtml: string): number[] {
  const ids = new Set<number>();
  const re = /\/config\/spec\/(\d+)\.html/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seriesHtml)) !== null) {
    ids.add(Number(m[1]));
  }
  return [...ids];
}

/** 去掉所有 HTML 标签，返回纯文本。 */
function stripTags(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** 从车型名称提取年份，如"A6L 2025款 改款 40 TFSI" → "2025"。 */
export function extractYear(modelName: string): string {
  const m = /(\d{4})款/.exec(modelName);
  return m ? m[1] : '';
}

/** 从车型名称提取排量，如"2.0T 190马力 L4" → "2.0"。 */
export function extractDisplacementFromName(modelName: string): string {
  const m = /(\d+\.\d+)[TL]/.exec(modelName);
  return m ? m[1] : '';
}

interface AutoHomeConfig {
  result: {
    paramtypeitems: Array<{
      name: string;
      paramitems: Array<{
        name: string;
        valueitems: Array<{ specid: number; value: string }>;
      }>;
    }>;
  };
}

/** 从参数页提取 var config JSON。 */
function parseSpecConfig(specHtml: string): AutoHomeConfig | null {
  const re = /var config\s*=\s*(\{)/;
  const m = re.exec(specHtml);
  if (!m) return null;

  const start = m.index + m[0].length - 1;
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < specHtml.length; i++) {
    const ch = specHtml[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(specHtml.slice(start, i + 1)) as AutoHomeConfig;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 从参数页提取 specIDs 列表。 */
function extractSpecIdsFromSpecPage(specHtml: string): number[] {
  const m = /var specIDs\s*=\s*\[([^\]]+)\]/.exec(specHtml);
  if (!m) return [];
  return m[1].split(',').map(Number).filter((n) => !isNaN(n));
}

/** 单个车型信息。 */
export interface CarModel {
  specId: number;
  brand: string;
  series: string;
  modelName: string;
  year: string;
  displacement: string; // 单位 L，如 "2.0"
}

/** 从参数页 title 提取品牌名。title 格式：【...】价格单_奥迪_汽车之家 */
function extractBrandFromTitle(specHtml: string): string {
  const m = /<title>([^<]+)<\/title>/.exec(specHtml);
  if (!m) return '';
  const parts = m[1].split('_');
  // 格式: 【...】价格单_奥迪_汽车之家 → parts = ['【...】价格单', '奥迪', '汽车之家']
  if (parts.length >= 3) return parts[parts.length - 2].trim();
  return '';
}

/**
 * 从停售页提取品牌名。
 * 页面格式：<a href="/78/">广汽本田-雅阁</a> 或 <a href="/78/">本田-雅阁</a>
 * 取 "-" 前面的部分作为品牌名。
 */
function extractBrandFromSalePage(saleHtml: string): string {
  // 匹配 <a href="/XXXX/">品牌-车系名</a> 或 <a href="/XXXX/">品牌车系名</a>
  const m = /<a\s+href="\/\d+\/">([^<]+)<\/a>/.exec(saleHtml);
  if (!m) return '';
  const text = stripTags(m[1]);
  // 格式: 广汽本田-雅阁 → 品牌=广汽本田
  // 或: 本田-雅阁 → 品牌=本田
  const dashIdx = text.indexOf('-');
  if (dashIdx > 0) return text.substring(0, dashIdx).trim();
  return '';
}

/**
 * 从参数页解析所有车型信息（品牌、车系、车型名称、年份、排量）。
 *
 * 排量优先从参数表拿（精确），fallback 从车型名称提取。
 */
export function parseModels(
  specHtml: string,
  series: string,
): CarModel[] {
  const config = parseSpecConfig(specHtml);
  if (!config) return [];

  const brand = extractBrandFromTitle(specHtml);

  // 1. 提取车型名称
  const nameMap = new Map<number, string>();
  const paramItems = config.result?.paramtypeitems?.[0]?.paramitems ?? [];
  for (const item of paramItems) {
    if (item.name.includes('车型') || item.name.includes('车款')) {
      for (const v of item.valueitems) {
        nameMap.set(v.specid, stripTags(v.value));
      }
      break;
    }
  }

  // 2. 提取排量（从参数表）
  const displacementMap = new Map<number, string>();
  for (const pt of config.result.paramtypeitems) {
    for (const item of pt.paramitems) {
      const nameClean = stripTags(item.name);
      // 排量(L) 的值在 0.5-8.0 之间；油箱容积(L) 在 30-150
      if (nameClean === '(L)' || nameClean.includes('排量') && nameClean.includes('L')) {
        for (const v of item.valueitems) {
          const val = stripTags(v.value);
          const num = parseFloat(val);
          if (!isNaN(num) && num > 0 && num < 10) {
            displacementMap.set(v.specid, val);
          }
        }
      }
    }
  }

  // 3. 合并
  const specIds = extractSpecIdsFromSpecPage(specHtml);
  const allIds = new Set([...nameMap.keys(), ...specIds]);
  const models: CarModel[] = [];

  for (const specId of allIds) {
    const modelName = nameMap.get(specId) ?? `spec-${specId}`;
    if (!nameMap.has(specId)) continue; // 跳过没有名称的

    const year = extractYear(modelName);
    let displacement = displacementMap.get(specId) ?? '';
    if (!displacement) {
      displacement = extractDisplacementFromName(modelName);
    }

    models.push({ specId, brand, series, modelName, year, displacement });
  }

  return models;
}

/**
 * 从停售页解析所有停售年款的车型列表。
 *
 * 页面格式（GBK）：
 *   <a title='2025款 260TURBO 舒适版' href='//www.autohome.com.cn/spec/70014/'>2025款 260TURBO 舒适版</a>
 *   <a href="/78/">广汽本田-雅阁</a>  ← 品牌信息
 *
 * 返回所有停售年款的车型（specid + 名称 + 年份 + 品牌）。
 */
export function parseSalePage(saleHtml: string, series: string): CarModel[] {
  const models: CarModel[] = [];
  const seen = new Set<number>();

  // 提取品牌名
  const brand = extractBrandFromSalePage(saleHtml);

  // 匹配 <a title='YYYY款 ...' href='//www.autohome.com.cn/spec/XXXXX/'>...</a>
  const re = /<a\s+title='([^']+)'\s+[^>]*href='\/\/www\.autohome\.com\.cn\/spec\/(\d+)\/'/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(saleHtml)) !== null) {
    const modelName = m[1].trim();
    const specId = Number(m[2]);
    if (seen.has(specId)) continue;
    seen.add(specId);

    const year = extractYear(modelName);
    const displacement = extractDisplacementFromName(modelName);

    models.push({ specId, brand, series, modelName, year, displacement });
  }

  return models;
}

/**
 * 从车系配置页解析在售年款的车型列表（含排量和品牌）。
 *
 * 页面格式（UTF-8）：
 *   var config = {"result":{"paramtypeitems":[...]}};
 *   var specIDs = [78334, 78335, 78336];
 */
export function parseConfigSeriesPage(configHtml: string, series: string): CarModel[] {
  return parseModels(configHtml, series);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
