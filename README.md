# play_QQ

TRSS-Yunzai QQ群情景演绎游戏插件 — AI主持人，支持狼人杀、推理、自定义剧本

## 安装

### 锅巴面板安装（推荐）

锅巴面板 → Plugin 插件 → 添加插件 → Git 安装，输入：

```
https://github.com/myflycat/play_QQ
```

### 手动安装

```bash
cd TRSS-Yunzai/plugins/
git clone https://github.com/myflycat/play_QQ.git
# 重启 Bot
```

## 配置

### LLM API（必需）

游戏依赖大模型 API 进行叙事和主持。二选一配置：

**方式一：.env 文件**（插件根目录）

```env
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-3.5-turbo
CURRENT_SCENARIO=werewolf
```

**方式二：锅巴面板**

在锅巴面板 → play_QQ 插件配置中填写 LLM API Key、地址和模型。

## 命令

### 游戏流程

| 命令 | 说明 |
|------|------|
| `/start` / `#开始游戏` | 开始报名 |
| `加一` / `+1` / `报名` | 参与报名 |
| `/cancel` / `#取消游戏` | 取消游戏（仅管理员） |
| `/end` / `#结束游戏` | 强制结束（仅管理员） |
| `#状态` | 查看当前游戏状态 |

### 游戏中交互

| 操作 | 说明 |
|------|------|
| `@用户名` | 投票给某个玩家 |
| `编号` | 回复数字选择第N个玩家 |

### 情景管理

| 命令 | 说明 |
|------|------|
| `#情景列表` | 查看所有可用情景 |
| `#查看情景 <id>` | 查看情景详情 |
| `#加载情景 <id>` | 切换默认情景（仅管理员） |

## 内置情景

| 情景 | ID | 人数 |
|------|----|------|
| 狼人杀 | werewolf | 6-12 |
| 简易推理 | simple_mystery | 3-8 |

## 自定义情景

编辑 `data/scenarios.json` 或在锅巴面板中管理。情景数据结构：

```json
{
  "id": "my_scenario",
  "name": "情景名称",
  "description": "简介",
  "min_players": 3,
  "max_players": 6,
  "roles": ["角色A", "角色B×2"],
  "game_process": [
    {"step": "step_id", "type": "narrate|vote|discuss|choose|multi_vote", "prompt": "主持人的引导词", "timeout": 60}
  ],
  "end_condition": "结束条件描述",
  "end_prompt": "总结提示"
}
```

### 步骤类型

| type | 说明 |
|------|------|
| `narrate` | AI 纯叙事，自动推进 |
| `discuss` | 讨论阶段，等待超时后继续 |
| `vote` | 全员投票 |
| `multi_vote` | 限定角色投票（需设置 targetRole） |
| `choose` | 单人选择 |
