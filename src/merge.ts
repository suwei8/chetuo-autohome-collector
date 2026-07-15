/**
 * 合并多个分片 CSV 并转换为 car-models.json 格式。
 *
 * 输入：output/car_models.csv（或多个分片 CSV）
 *   品牌,车系,specId,车型名称,年份,排量L
 *
 * 输出：output/car-models.json
 *   [{ brand, series: [{ name, models: [{ name, year }] }] }]
 *
 * 用法：
 *   npx tsx src/merge.ts                    # 合并 output/car_models.csv
 *   npx tsx src/merge.ts shard-0.csv shard-1.csv ...  # 合并指定文件
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

interface CarModel {
  name: string;
  year: string;
}
interface CarSeries {
  name: string;
  models: CarModel[];
}
interface CarBrand {
  brand: string;
  series: CarSeries[];
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { fields.push(current); current = ''; }
      else current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function main(): void {
  const outputDir = 'output';
  let files: string[];

  if (process.argv.length > 2) {
    files = process.argv.slice(2);
  } else {
    // 自动找 output 下所有 car_models*.csv
    files = readdirSync(outputDir)
      .filter((f) => f.startsWith('car_models') && f.endsWith('.csv'))
      .map((f) => join(outputDir, f));
  }

  if (files.length === 0) {
    console.error('未找到 CSV 文件');
    process.exit(1);
  }

  console.log(`合并 ${files.length} 个文件:`);
  files.forEach((f) => console.log(`  ${f}`));

  // brand → series → models
  const brandMap = new Map<string, Map<string, Map<string, CarModel>>>();
  let totalRows = 0;

  for (const file of files) {
    const text = readFileSync(file, 'utf-8');
    const lines = text.split('\n').filter((l) => l.trim());

    for (let i = 0; i < lines.length; i++) {
      if (i === 0 && lines[i].startsWith('品牌')) continue; // 跳过表头
      const fields = parseCsvLine(lines[i]);
      if (fields.length < 5) continue;

      const [brand, series, , modelName, year] = fields;
      if (!brand || !series || !modelName) continue;

      totalRows++;

      let seriesMap = brandMap.get(brand);
      if (!seriesMap) { seriesMap = new Map(); brandMap.set(brand, seriesMap); }

      let modelMap = seriesMap.get(series);
      if (!modelMap) { modelMap = new Map(); seriesMap.set(series, modelMap); }

      // 用 modelName 作为 key 去重（同年同名的只保留一个）
      const key = `${modelName}|${year}`;
      modelMap.set(key, { name: modelName, year: year || '' });
    }
  }

  // 构建 JSON 数组
  const brands: CarBrand[] = [];
  for (const [brandName, seriesMap] of brandMap) {
    const seriesList: CarSeries[] = [];
    for (const [seriesName, modelMap] of seriesMap) {
      const models = [...modelMap.values()].sort((a, b) => {
        // 按年份降序，同年按名称排序
        const yearDiff = Number(b.year) - Number(a.year);
        if (yearDiff !== 0) return yearDiff;
        return a.name.localeCompare(b.name, 'zh');
      });
      seriesList.push({ name: seriesName, models });
    }
    seriesList.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    brands.push({ brand: brandName, series: seriesList });
  }

  brands.sort((a, b) => a.brand.localeCompare(b.brand, 'zh'));

  const json = JSON.stringify(brands);
  const outPath = join(outputDir, 'car-models.json');
  writeFileSync(outPath, json, 'utf-8');

  // 统计
  let totalSeries = 0, totalModels = 0;
  for (const b of brands) {
    totalSeries += b.series.length;
    for (const s of b.series) totalModels += s.models.length;
  }

  console.log(`\n=== 合并完成 ===`);
  console.log(`品牌: ${brands.length}`);
  console.log(`车系: ${totalSeries}`);
  console.log(`车型: ${totalModels}`);
  console.log(`CSV 总行数: ${totalRows}`);
  console.log(`输出: ${outPath} (${(json.length / 1024).toFixed(0)} KB)`);
}

main();
