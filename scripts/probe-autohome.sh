#!/usr/bin/env bash
# 验证汽车之家是否封锁当前 IP。
#
# 用法： bash scripts/probe-autohome.sh
#
# 输出三组探测结果到 stdout，供 workflow 日志查看：
#   1. 品牌总览页 https://car.autohome.com.cn/brand/
#   2. 单个车系价格页 https://car.autohome.com.cn/price/series-18.html （奥迪A6L）
#   3. 单个车型参数页 https://car.autohome.com.cn/config/spec/71526.html
#
# 每组记录：HTTP 状态码、响应字节、是否含中文内容、是否被重定向到验证/封禁页。
# 重复 3 轮，每轮间隔 10 秒，模拟轻度连续访问。

set -uo pipefail

BRAND_URL="https://car.autohome.com.cn/brand/"
SERIES_URL="https://car.autohome.com.cn/price/series-18.html"
SPEC_URL="https://car.autohome.com.cn/config/spec/71526.html"

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

# 封禁/验证页特征词
BLOCK_KEYWORDS="人机验证|验证|访问受限|访问被拒|forbidden|blocked|captcha|安全验证|请稍后再试"

probe_once() {
  local label="$1"
  local url="$2"
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

  # 是否含中文车型内容（简单判定：含"奥迪"或"汽车之家"或"参数"）
  local has_content
  if grep -qE "奥迪|汽车之家|参数配置|车型|指导价" "$tmp" 2>/dev/null; then
    has_content="yes"
  else
    has_content="no"
  fi

  # 是否命中封禁/验证页
  local blocked
  if grep -qE "$BLOCK_KEYWORDS" "$tmp" 2>/dev/null; then
    blocked="yes"
  else
    blocked="no"
  fi

  # 最终 URL（看是否被重定向）
  local final_url
  final_url=$(curl -sS -o /dev/null -w "%{url_effective}" \
    -A "$UA" --max-time 15 -L "$url" 2>/dev/null || echo "unknown")

  echo "  [$label] http=$http_code size=${size}B has_content=$has_content blocked=$blocked final_url=$final_url"

  rm -f "$tmp"
}

ROUNDS=3
INTERVAL=10

for round in $(seq 1 $ROUNDS); do
  echo ""
  echo "===== 第 ${round}/${ROUNDS} 轮探测 ====="
  echo "时间: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo ""

  probe_once "品牌总览页" "$BRAND_URL"
  sleep 2
  probe_once "车系价格页" "$SERIES_URL"
  sleep 2
  probe_once "车型参数页" "$SPEC_URL"

  if [ "$round" -lt "$ROUNDS" ]; then
    echo ""
    echo "  等待 ${INTERVAL} 秒后进入下一轮..."
    sleep "$INTERVAL"
  fi
done

echo ""
echo "===== 探测结束 ====="
echo ""
echo "判定标准："
echo "  - http=200 + has_content=yes + blocked=no  → 该 IP 可访问汽车之家"
echo "  - http=403/451/302跳验证 + blocked=yes     → 该 IP 被封或被要求验证"
echo "  - http=000                                 → 网络层被拒（连接重置/超时）"
echo "  - has_content=no 但 http=200               → 可能返回了空壳/反爬页"
