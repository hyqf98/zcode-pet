#!/usr/bin/env bash
# 端到端测试：模拟 ZCode hook 推送事件流到宠物应用的本地 HTTP 服务。
#
# 用法：./scripts/test-hook-e2e.sh
#
# 原理：ZCode hook 脚本（zcode-pet-hook.mjs）的作用是读 stdin JSON 后 POST 到
# 本地 HTTP 服务。本脚本跳过 hook 脚本，直接用 curl POST 模拟 ZCode 发出的 7 类事件，
# 验证「HTTP 服务 → Tauri emit_to(pet) → 前端监听 → mapEvent → 通知队列 → 宠物动画+气泡」全链路。
#
# 观察点：每次推送后，宠物应切换到对应动画 + 头顶气泡显示本地化文案。

set -euo pipefail

PORT_FILE="$HOME/Library/Application Support/io.github.hyqf.zcode-pet/zcode-pet.port"

if [ ! -f "$PORT_FILE" ]; then
  echo "❌ 端口文件不存在：$PORT_FILE"
  echo "   请先启动 zcode_pet 应用。"
  exit 1
fi

PORT=$(cat "$PORT_FILE")
URL="http://127.0.0.1:${PORT}/hook"
echo "🎯 目标: $URL"
echo ""

# 先探测健康检查
echo "--- 健康检查 ---"
HEALTH=$(curl -s "http://127.0.0.1:${PORT}/health" || echo "FAIL")
echo "$HEALTH"
echo ""

post() {
  local label="$1"
  local json="$2"
  echo "📤 [$label]"
  echo "   payload: $json"
  local resp
  resp=$(curl -s -X POST "$URL" \
    -H "Content-Type: application/json" \
    -d "$json" 2>&1 || echo "CURL_ERROR")
  echo "   响应: $resp"
  echo ""
}

echo "==================== 模拟 ZCode AI 工作流 ===================="
echo ""

# 1. 会话开始
post "SessionStart" '{"hook_event_name":"SessionStart","source":"startup"}'
sleep 2

# 2. 用户提交 prompt
post "UserPromptSubmit" '{"hook_event_name":"UserPromptSubmit","prompt":"帮我重构这个函数"}'
sleep 2

# 3. 工具调用前（编辑文件）
post "PreToolUse (Write)" '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"src/utils/format.ts"}}'
sleep 2

# 4. 工具调用后
post "PostToolUse (Write)" '{"hook_event_name":"PostToolUse","tool_name":"Write","tool_response":{"success":true}}'
sleep 2

# 5. 工具失败
post "PostToolUseFailure (Bash)" '{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","error":"command not found: foo"}'
sleep 2

# 6. 权限请求
post "PermissionRequest" '{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/test"}}'
sleep 2

# 7. 会话结束
post "Stop" '{"hook_event_name":"Stop","last_assistant_message":"我已经完成了重构，修改了 3 个文件，添加了类型注解。"}'

echo "==================== 推送完成 ===================="
echo ""
echo "✅ 已推送 7 类事件。请观察桌面宠物："
echo "   - 每次推送后宠物应切换动画（waving/waiting/running/review/failed/jumping）"
echo "   - 头顶气泡应显示对应中/英文文案（打字机效果）"
echo "   - error（PostToolUseFailure）应即时显示（不走打字机）"
