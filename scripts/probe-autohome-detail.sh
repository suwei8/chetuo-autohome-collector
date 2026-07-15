#!/usr/bin/env bash
# 阶段 0.1：深入探测汽车之家页面结构，搞清楚：
#   1. /brand/ 404 是 URL 错还是真不存在 → 试几个候选入口
#   2. /price/series-18.html 200 但 has_content=no → 是 JS 渲染还是反爬空壳
#   3. /config/spec/71526.html 200 + has_content=yes → 确认可解析
#
# 不传输任何数据，只把响应片段打印到日志。

set -uo pipefail

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

fetch() {
  local url="$1"
  local label="$2"
  local tmp
  tmp=$(mktemp)

  local http_code
  http_code=$(curl -sS -o "$tmp" -w "%{http_code}" \
    -A "$UA" \
    --max-time 30 \
    --compressed \
    -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
    -H "Accept-Language: zh-CN,zh;q=0.9" \
    -H "Referer: https://www.autohome.com.cn/" \
    "$url" 2>/dev/null || echo "000")

  local size
  size=$(wc -c < "$tmp" 2>/dev/null || echo 0)

  echo ""
  echo "------------------------------------------------------------"
  echo "[$label] $url"
  echo "  http=$http_code size=${size}B"
  echo ""
  echo "  --- <title> 标签 ---"
  grep -oiE "<title>[^<]*</title>" "$tmp" 2>/dev/null | head -1 | sed 's/^/  /'
  echo ""
  echo "  --- 前 500 字节（去标签后）---"
  sed 's/<[^>]*>//g' "$tmp" 2>/dev/null | tr -s '[:space:]' ' ' | head -c 500 | sed 's/^/  /'
  echo ""
  echo ""
  echo "  --- 关键词命中 ---"
  for kw in 奥迪 汽车 之家 参数 配置 车型 指导价 车系 品牌 series_ spec; do
    if grep -q "$kw" "$tmp" 2>/dev/null; then
      echo "    命中: $kw"
    fi
  done
  echo ""
  echo "  --- 是否含 JSON 数据块（__NEXT_DATA__ / window.__INITIAL / var configSpec）---"
  for pat in "__NEXT_DATA__" "__INITIAL_STATE__" "configSpec" "specData" "seriesData" "var spec" "window\\._data"; do
    if grep -q "$pat" "$tmp" 2>/dev/null; then
      echo "    命中: $pat"
    fi
  done

  rm -f "$tmp"
}

echo "===== 阶段 0.1：页面结构深入探测 ====="
echo "时间: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

# 1. 候选品牌入口 URL
fetch "https://car.autohome.com.cn/brand/" "品牌总览页(原)"
fetch "https://www.autohome.com.cn/car/" "汽车之家/car/"
fetch "https://car.autohome.com.cn/" "car.autohome 首页"
fetch "https://www.autohome.com.cn/" "www.autohome 首页"

# 2. 车系价格页（重点：搞清楚 has_content=no 的原因）
fetch "https://car.autohome.com.cn/price/series-18.html" "车系价格页 series-18"

# 3. 车型参数页（确认能拿到数据）
fetch "https://car.autohome.com.cn/config/spec/71526.html" "车型参数页 spec-71526"

# 4. 试一个汽车之家的 API 接口（很多页面是 AJAX 拿数据的）
echo ""
echo "===== 尝试汽车之家 AJAX 接口 ====="
fetch "https://car.autohome.com.cn/PlatformAPI/GetSeriesList?brandId=33" "GetSeriesList(品牌33奥迪)"
fetch "https://car-web-api.autohome.com.cn/CarInfo/GetSeriesList?_appid=car&brandId=33" "CarInfo GetSeriesList"

echo ""
echo "===== 探测结束 ====="
