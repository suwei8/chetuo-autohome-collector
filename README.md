# chetuo-autohome-collector

车妥（CheTuo）车型库采集器 —— 从汽车之家采集品牌 / 车系 / 年款 / 车型 / 参数配置。

> 本仓库只存放采集脚本与 GitHub Actions workflow，**不存放任何采集到的数据**。
> 数据在 workflow 内部生成后直接传输到车妥服务器，不提交回仓库。

## 目标

- 数据源：汽车之家（autohome.com.cn）
- 采集范围：品牌 → 车系 → 车型（年款）→ 参数配置
- 更新频率：月更（与 swoiow/autohome 对齐，互为校验）
- 用途：仅供车妥项目内部使用，不对外公开数据

## 现状

阶段 0：验证 GitHub Actions IP 段是否被汽车之家封锁。

### 探测 workflow

`.github/workflows/probe.yml` 会：

1. 显示 runner 公网 IP 和对 `car.autohome.com.cn` 的 DNS 解析
2. 用浏览器 UA 请求 3 个汽车之家页面（品牌总览页 / 车系价格页 / 车型参数页）
3. 记录 HTTP 状态码、响应字节、是否含正常中文内容、是否命中封禁/验证页
4. 重复 3 轮，每轮间隔 10 秒
5. 支持手动触发（workflow_dispatch）和每日定时（UTC 04:00）

### 判定标准

| 信号 | 含义 |
|---|---|
| `http=200 + has_content=yes + blocked=no` | 该 IP 可正常访问汽车之家 |
| `http=403/451/302跳验证 + blocked=yes` | 该 IP 被封或被要求人机验证 |
| `http=000` | 网络层被拒（连接重置/超时） |
| `has_content=no` 但 `http=200` | 可能返回了空壳/反爬页 |

### 手动触发

GitHub 仓库 → Actions → `Probe AutoHome` → Run workflow

### 后续

- 如果 GitHub Actions IP 可用：在本仓库继续实现完整采集 workflow。
- 如果被封：采集逻辑迁到车妥服务器或独立 VPS，本仓库只做 swoiow 基线下载 + 转换 + 传输。
